// Package logstore is the agent's on-disk buffer for the data logger: one
// append-only file per log, written before anything is sent to the browser,
// so closing the tab, a browser crash or a reload loses nothing. The browser
// syncs by sequence number (log.fetch) and acknowledges (log.ack).
//
// Record layout (little endian):
//
//	u32 length of the rest | u64 seq | i64 t (ms, UTC) | f32 cycleMs | u16 blocks
//	per block: u8 status (0 ok, 1 error)
//	  ok:    u16 words, words as u16
//	  error: u8 code index, u8 exception
//	u32 CRC-32 (IEEE) of everything after the length
//
// A torn last record (power loss mid-write) fails its CRC and is cut off on open.
package logstore

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Codes is the order used to store error codes in one byte.
var Codes = []string{"TIMEOUT", "CRC_ERROR", "INVALID_RESPONSE", "MODBUS_EXCEPTION", "PORT_BUSY", "PORT_DISCONNECTED", "PERMISSION_DENIED", "CONN_REFUSED"}

func codeIndex(c string) byte {
	for i, x := range Codes {
		if x == c {
			return byte(i)
		}
	}
	return 2 // INVALID_RESPONSE
}

// Result is one block's outcome in a cycle.
type Result struct {
	Words     []uint16 `json:"words,omitempty"`
	Error     string   `json:"error,omitempty"`
	Exception byte     `json:"exception,omitempty"`
}

// Record is one cycle.
type Record struct {
	Seq     uint64   `json:"seq"`
	T       int64    `json:"t"`
	CycleMs float32  `json:"cycleMs"`
	Results []Result `json:"results"`
}

// Meta describes a log; it is rewritten (atomically) when the state changes.
type Meta struct {
	ID         string          `json:"logId"`
	Name       string          `json:"name"`
	Conn       json.RawMessage `json:"conn"`
	Blocks     json.RawMessage `json:"blocks"`
	IntervalMs int             `json:"intervalMs"`
	TimeoutMs  int             `json:"timeoutMs"`
	StartedAt  time.Time       `json:"startedAt"`
	StopAt     *time.Time      `json:"stopAt,omitempty"`
	StoppedAt  *time.Time      `json:"stoppedAt,omitempty"`
	LastSeq    uint64          `json:"lastSeq"`
	AckedSeq   uint64          `json:"ackedSeq"`
	Running    bool            `json:"running"`
	Bytes      int64           `json:"bytes"`
}

func encode(r Record) []byte {
	b := binary.LittleEndian.AppendUint64(nil, r.Seq)
	b = binary.LittleEndian.AppendUint64(b, uint64(r.T))
	b = binary.LittleEndian.AppendUint32(b, mathFloat32bits(r.CycleMs))
	b = binary.LittleEndian.AppendUint16(b, uint16(len(r.Results)))
	for _, res := range r.Results {
		if res.Error != "" {
			b = append(b, 1, codeIndex(res.Error), res.Exception)
			continue
		}
		b = append(b, 0)
		b = binary.LittleEndian.AppendUint16(b, uint16(len(res.Words)))
		for _, w := range res.Words {
			b = binary.LittleEndian.AppendUint16(b, w)
		}
	}
	b = binary.LittleEndian.AppendUint32(b, crc32.ChecksumIEEE(b))
	return append(binary.LittleEndian.AppendUint32(nil, uint32(len(b))), b...)
}

var errCorrupt = errors.New("corrupt record")

func decode(body []byte) (Record, error) {
	if len(body) < 26 {
		return Record{}, errCorrupt
	}
	n := len(body) - 4
	if crc32.ChecksumIEEE(body[:n]) != binary.LittleEndian.Uint32(body[n:]) {
		return Record{}, errCorrupt
	}
	r := Record{
		Seq:     binary.LittleEndian.Uint64(body),
		T:       int64(binary.LittleEndian.Uint64(body[8:])),
		CycleMs: mathFloat32frombits(binary.LittleEndian.Uint32(body[16:])),
	}
	blocks := int(binary.LittleEndian.Uint16(body[20:]))
	i := 22
	for k := 0; k < blocks; k++ {
		if i >= n {
			return Record{}, errCorrupt
		}
		if body[i] == 1 {
			if i+3 > n {
				return Record{}, errCorrupt
			}
			code := "INVALID_RESPONSE"
			if int(body[i+1]) < len(Codes) {
				code = Codes[body[i+1]]
			}
			r.Results = append(r.Results, Result{Error: code, Exception: body[i+2]})
			i += 3
			continue
		}
		if i+3 > n {
			return Record{}, errCorrupt
		}
		w := int(binary.LittleEndian.Uint16(body[i+1:]))
		i += 3
		if i+2*w > n {
			return Record{}, errCorrupt
		}
		words := make([]uint16, w)
		for j := range words {
			words[j] = binary.LittleEndian.Uint16(body[i+2*j:])
		}
		r.Results = append(r.Results, Result{Words: words})
		i += 2 * w
	}
	return r, nil
}

// Log is one open log file.
type Log struct {
	mu    sync.Mutex
	dir   string
	meta  Meta
	f     *os.File
	w     *bufio.Writer
	index []indexEntry // sparse: every indexEvery records
	lastT time.Time
}

type indexEntry struct {
	seq uint64
	off int64
}

const indexEvery = 256

// Store is the directory of logs.
type Store struct {
	dir  string
	mu   sync.Mutex
	logs map[string]*Log
}

// Open loads every log in dir (logs that were running when the agent stopped stay "running").
func Open(dir string) (*Store, error) {
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	s := &Store{dir: dir, logs: map[string]*Log{}}
	metas, _ := filepath.Glob(filepath.Join(dir, "*.json"))
	for _, m := range metas {
		raw, err := os.ReadFile(m)
		if err != nil {
			continue
		}
		var meta Meta
		if json.Unmarshal(raw, &meta) != nil || meta.ID == "" {
			continue
		}
		l, err := s.open(meta)
		if err != nil {
			return nil, fmt.Errorf("log %s: %w", meta.ID, err)
		}
		s.logs[meta.ID] = l
	}
	return s, nil
}

func (s *Store) open(meta Meta) (*Log, error) {
	l := &Log{dir: s.dir, meta: meta}
	path := filepath.Join(s.dir, meta.ID+".mflog")
	f, err := os.OpenFile(path, os.O_RDWR|os.O_CREATE, 0o600)
	if err != nil {
		return nil, err
	}
	// Rebuild the index and cut off a torn tail.
	var off int64
	var last uint64
	r := bufio.NewReader(f)
	count := 0
	for {
		var hdr [4]byte
		if _, err := io.ReadFull(r, hdr[:]); err != nil {
			break
		}
		n := binary.LittleEndian.Uint32(hdr[:])
		body := make([]byte, n)
		if _, err := io.ReadFull(r, body); err != nil {
			break
		}
		rec, err := decode(body)
		if err != nil {
			break
		}
		if count%indexEvery == 0 {
			l.index = append(l.index, indexEntry{rec.Seq, off})
		}
		count++
		last = rec.Seq
		l.lastT = time.UnixMilli(rec.T)
		off += 4 + int64(n)
	}
	if err := f.Truncate(off); err != nil {
		f.Close()
		return nil, err
	}
	if _, err := f.Seek(off, io.SeekStart); err != nil {
		f.Close()
		return nil, err
	}
	l.f, l.w = f, bufio.NewWriter(f)
	l.meta.LastSeq = last
	l.meta.Bytes = off
	return l, l.saveMeta()
}

// Create starts a new log.
func (s *Store) Create(meta Meta) (*Log, error) {
	meta.Running = true
	l, err := s.open(meta)
	if err != nil {
		return nil, err
	}
	s.mu.Lock()
	s.logs[meta.ID] = l
	s.mu.Unlock()
	return l, nil
}

// Get returns a log by id.
func (s *Store) Get(id string) *Log {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.logs[id]
}

// List returns every log's metadata, newest first.
func (s *Store) List() []Meta {
	s.mu.Lock()
	out := make([]Meta, 0, len(s.logs))
	for _, l := range s.logs {
		out = append(out, l.Meta())
	}
	s.mu.Unlock()
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out
}

// Delete removes a log's files.
func (s *Store) Delete(id string) error {
	s.mu.Lock()
	l := s.logs[id]
	delete(s.logs, id)
	s.mu.Unlock()
	if l == nil {
		return nil
	}
	l.mu.Lock()
	_ = l.w.Flush()
	_ = l.f.Close()
	l.mu.Unlock()
	_ = os.Remove(filepath.Join(s.dir, id+".mflog"))
	return os.Remove(filepath.Join(s.dir, id+".json"))
}

// Prune deletes stopped logs fully acknowledged by the browser more than maxAge ago.
func (s *Store) Prune(maxAge time.Duration) {
	for _, m := range s.List() {
		if !m.Running && m.AckedSeq >= m.LastSeq && m.StoppedAt != nil && time.Since(*m.StoppedAt) > maxAge {
			_ = s.Delete(m.ID)
		}
	}
}

// Meta returns a copy of the metadata.
func (l *Log) Meta() Meta {
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.meta
}

func (l *Log) saveMeta() error {
	raw, _ := json.MarshalIndent(l.meta, "", "  ")
	tmp := filepath.Join(l.dir, l.meta.ID+".json.tmp")
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, filepath.Join(l.dir, l.meta.ID+".json"))
}

// Append writes one cycle and assigns its sequence number. The data is
// flushed to the OS before returning, so a browser that sees the record can
// rely on it being on disk.
func (l *Log) Append(t time.Time, cycleMs float32, results []Result) (Record, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	rec := Record{Seq: l.meta.LastSeq + 1, T: t.UnixMilli(), CycleMs: cycleMs, Results: results}
	b := encode(rec)
	if (rec.Seq-1)%indexEvery == 0 {
		l.index = append(l.index, indexEntry{rec.Seq, l.meta.Bytes})
	}
	if _, err := l.w.Write(b); err != nil {
		return rec, err
	}
	if err := l.w.Flush(); err != nil {
		return rec, err
	}
	l.meta.LastSeq = rec.Seq
	l.meta.Bytes += int64(len(b))
	l.lastT = t
	// The metadata (lastSeq) is rebuilt from the file on open; rewriting it
	// every cycle would double the disk writes.
	return rec, nil
}

// Read returns up to max records with seq >= from.
func (l *Log) Read(from uint64, max int) ([]Record, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if err := l.w.Flush(); err != nil {
		return nil, err
	}
	off := int64(0)
	for _, e := range l.index {
		if e.seq > from {
			break
		}
		off = e.off
	}
	r := io.NewSectionReader(l.f, off, l.meta.Bytes-off)
	br := bufio.NewReader(r)
	var out []Record
	for len(out) < max {
		var hdr [4]byte
		if _, err := io.ReadFull(br, hdr[:]); err != nil {
			break
		}
		body := make([]byte, binary.LittleEndian.Uint32(hdr[:]))
		if _, err := io.ReadFull(br, body); err != nil {
			break
		}
		rec, err := decode(body)
		if err != nil {
			return out, err
		}
		if rec.Seq >= from {
			out = append(out, rec)
		}
	}
	return out, nil
}

// Update changes metadata (running state, ack) and persists it.
func (l *Log) Update(fn func(*Meta)) error {
	l.mu.Lock()
	defer l.mu.Unlock()
	fn(&l.meta)
	return l.saveMeta()
}

// Close flushes and closes the file.
func (l *Log) Close() error {
	l.mu.Lock()
	defer l.mu.Unlock()
	_ = l.w.Flush()
	_ = l.saveMeta()
	return l.f.Close()
}
