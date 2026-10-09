package agent

import (
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"modfield.dev/agent/internal/logstore"
	"modfield.dev/agent/internal/modbus"
	"modfield.dev/agent/internal/platform"
)

// Keep logs the browser has fully synced for this long after they stop.
const logRetention = 30 * 24 * time.Hour

// Warn when free disk space drops below this while logging.
const lowDiskBytes = 1 << 30

// logger runs one data log: the poll cycle goes to disk first, then to the
// sessions watching it. It holds its connection open with no session at all.
type logger struct {
	a      *Agent
	log    *logstore.Log
	conn   *Conn
	blocks []Block
	stop   chan struct{}
	done   chan struct{}
	once   sync.Once

	mu   sync.Mutex
	subs map[*Session]bool
}

func (l *logger) subscribe(s *Session) {
	l.mu.Lock()
	l.subs[s] = true
	l.mu.Unlock()
}

func (l *logger) unsubscribe(s *Session) {
	l.mu.Lock()
	delete(l.subs, s)
	l.mu.Unlock()
}

// halt stops the goroutine without marking the log stopped (agent shutdown).
func (l *logger) halt() {
	l.once.Do(func() { close(l.stop) })
	<-l.done
}

func (l *logger) run() {
	defer close(l.done)
	meta := l.log.Meta()
	interval := time.Duration(meta.IntervalMs) * time.Millisecond
	to := timeout(meta.TimeoutMs)
	var lastReopen, lastDiskCheck time.Time
	for {
		start := time.Now()
		results := readBlocks(l.conn, l.blocks, to)
		rec := make([]logstore.Result, len(results))
		lost := len(results) > 0
		for i, r := range results {
			if r.Error != nil {
				rec[i] = logstore.Result{Error: string(r.Error.Code), Exception: r.Error.Exception}
				if r.Error.Code != modbus.ErrPortDisconnected {
					lost = false
				}
			} else {
				rec[i] = logstore.Result{Words: r.Words}
				lost = false
			}
		}
		saved, err := l.log.Append(start, float32(time.Since(start).Microseconds())/1000, rec)
		if err != nil {
			l.a.Log.Error("log write failed", "log", meta.ID, "err", err)
		} else {
			l.broadcast("log.cycle", map[string]any{"logId": meta.ID, "seq": saved.Seq, "t": saved.T, "cycleMs": saved.CycleMs, "results": saved.Results})
		}
		// The port went away (USB unplugged): keep logging the gap and try to reopen.
		if lost && time.Since(lastReopen) > 3*time.Second {
			lastReopen = time.Now()
			if err := l.conn.Reopen(l.a.onFrame); err == nil {
				l.a.Log.Info("log connection restored", "log", meta.ID)
			}
		}
		if time.Since(lastDiskCheck) > time.Hour {
			lastDiskCheck = time.Now()
			if free, err := platform.FreeBytes(l.a.DataDir); err == nil && free < lowDiskBytes {
				l.broadcast("log.warning", map[string]any{"logId": meta.ID, "freeBytes": free})
			}
		}
		if m := l.log.Meta(); m.StopAt != nil && time.Now().After(*m.StopAt) {
			l.a.finishLog(meta.ID)
			return
		}
		select {
		case <-l.stop:
			return
		case <-time.After(max(interval-time.Since(start), 0)):
		}
	}
}

func (l *logger) broadcast(method string, params any) {
	l.mu.Lock()
	subs := make([]*Session, 0, len(l.subs))
	for s := range l.subs {
		subs = append(subs, s)
	}
	l.mu.Unlock()
	for _, s := range subs {
		s.notify(method, params)
	}
}

// LogStartParams is log.start.
type LogStartParams struct {
	Name       string     `json:"name"`
	Conn       OpenParams `json:"conn"`
	Blocks     []Block    `json:"blocks"`
	IntervalMs int        `json:"intervalMs"`
	TimeoutMs  int        `json:"timeoutMs"`
	DurationMs int64      `json:"durationMs,omitempty"`
}

// connFor opens (or shares) the connection a log needs and pins it.
func (a *Agent) connFor(p OpenParams) (*Conn, error) {
	a.mu.Lock()
	for _, c := range a.conns {
		if c.Params == p {
			a.mu.Unlock()
			c.mu.Lock()
			c.pinned++
			if c.closeAt != nil {
				c.closeAt.Stop()
				c.closeAt = nil
			}
			c.mu.Unlock()
			return c, nil
		}
	}
	a.mu.Unlock()
	c, err := openConn(newID(), p, a.onFrame)
	if err != nil {
		return nil, err
	}
	c.pinned = 1
	a.mu.Lock()
	a.conns[c.ID] = c
	a.mu.Unlock()
	return c, nil
}

func (a *Agent) launch(log *logstore.Log, c *Conn, blocks []Block, owner *Session) *logger {
	l := &logger{a: a, log: log, conn: c, blocks: blocks, stop: make(chan struct{}), done: make(chan struct{}), subs: map[*Session]bool{}}
	if owner != nil {
		l.subs[owner] = true
	}
	a.mu.Lock()
	a.loggers[log.Meta().ID] = l
	a.mu.Unlock()
	go l.run()
	return l
}

// ResumeLogs restarts logs that were running when the agent stopped. A
// connection that cannot be reopened yet is retried by the logger itself.
func (a *Agent) ResumeLogs() {
	if a.Logs == nil {
		return
	}
	a.Logs.Prune(logRetention)
	for _, m := range a.Logs.List() {
		if !m.Running {
			continue
		}
		var p OpenParams
		var blocks []Block
		if json.Unmarshal(m.Conn, &p) != nil || json.Unmarshal(m.Blocks, &blocks) != nil {
			continue
		}
		c, err := a.connFor(p)
		if err != nil {
			// Placeholder connection: the logger records the gap and retries.
			c = &Conn{ID: newID(), Params: p, Label: p.label(), taps: map[*Session]bool{}, leases: map[*Session]bool{}, pinned: 1}
			a.mu.Lock()
			a.conns[c.ID] = c
			a.mu.Unlock()
		}
		a.launch(a.Logs.Get(m.ID), c, blocks, nil)
		a.Log.Info("log resumed", "log", m.ID, "name", m.Name)
	}
}

func (a *Agent) finishLog(id string) {
	a.mu.Lock()
	l := a.loggers[id]
	delete(a.loggers, id)
	a.mu.Unlock()
	if l == nil {
		return
	}
	now := time.Now().UTC()
	_ = l.log.Update(func(m *logstore.Meta) { m.Running = false; m.StoppedAt = &now })
	l.broadcast("log.stopped", map[string]any{"logId": id})
	l.conn.mu.Lock()
	l.conn.pinned--
	l.conn.mu.Unlock()
	a.maybeClose(l.conn)
}

func (a *Agent) logMethod(s *Session, method string, raw json.RawMessage) (any, error) {
	if a.Logs == nil {
		return nil, fmt.Errorf("logging is not available")
	}
	type idParams struct {
		LogID string `json:"logId"`
	}
	switch method {
	case "log.start":
		p, err := decode[LogStartParams](raw)
		if err != nil {
			return nil, err
		}
		if len(p.Blocks) == 0 || len(p.Blocks) > 500 || p.IntervalMs < 100 || p.IntervalMs > 3_600_000 {
			return nil, badParams("1..500 blocks and intervalMs 100..3600000")
		}
		c, err := a.connFor(p.Conn)
		if err != nil {
			return nil, err
		}
		connRaw, _ := json.Marshal(p.Conn)
		blocksRaw, _ := json.Marshal(p.Blocks)
		meta := logstore.Meta{ID: newID(), Name: p.Name, Conn: connRaw, Blocks: blocksRaw, IntervalMs: p.IntervalMs, TimeoutMs: p.TimeoutMs, StartedAt: time.Now().UTC()}
		if p.DurationMs > 0 {
			stop := meta.StartedAt.Add(time.Duration(p.DurationMs) * time.Millisecond)
			meta.StopAt = &stop
		}
		log, err := a.Logs.Create(meta)
		if err != nil {
			return nil, err
		}
		a.launch(log, c, p.Blocks, s)
		a.Log.Info("log started", "log", meta.ID, "name", p.Name, "conn", c.Label)
		return log.Meta(), nil
	case "log.stop":
		p, err := decode[idParams](raw)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		l := a.loggers[p.LogID]
		a.mu.Unlock()
		if l != nil {
			l.halt()
		}
		a.finishLog(p.LogID)
		return nil, nil
	case "log.list":
		var free uint64
		if a.DataDir != "" {
			free, _ = platform.FreeBytes(a.DataDir)
		}
		return map[string]any{"logs": a.Logs.List(), "freeBytes": free}, nil
	case "log.fetch":
		p, err := decode[struct {
			LogID   string `json:"logId"`
			FromSeq uint64 `json:"fromSeq"`
			Max     int    `json:"max"`
		}](raw)
		if err != nil {
			return nil, err
		}
		l := a.Logs.Get(p.LogID)
		if l == nil {
			return nil, badParams("unknown log")
		}
		if p.Max <= 0 || p.Max > 5000 {
			p.Max = 5000
		}
		recs, err := l.Read(max(p.FromSeq, 1), p.Max)
		if err != nil {
			return nil, err
		}
		if recs == nil {
			recs = []logstore.Record{}
		}
		return map[string]any{"records": recs, "lastSeq": l.Meta().LastSeq}, nil
	case "log.ack":
		p, err := decode[struct {
			LogID string `json:"logId"`
			Seq   uint64 `json:"seq"`
		}](raw)
		if err != nil {
			return nil, err
		}
		if l := a.Logs.Get(p.LogID); l != nil {
			_ = l.Update(func(m *logstore.Meta) { m.AckedSeq = max(m.AckedSeq, min(p.Seq, m.LastSeq)) })
		}
		return nil, nil
	case "log.subscribe":
		p, err := decode[idParams](raw)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		l := a.loggers[p.LogID]
		a.mu.Unlock()
		if l != nil {
			l.subscribe(s)
		}
		return nil, nil
	case "log.delete":
		p, err := decode[idParams](raw)
		if err != nil {
			return nil, err
		}
		a.mu.Lock()
		running := a.loggers[p.LogID] != nil
		a.mu.Unlock()
		if running {
			return nil, badParams("stop the log before deleting it")
		}
		return nil, a.Logs.Delete(p.LogID)
	}
	return nil, nil
}
