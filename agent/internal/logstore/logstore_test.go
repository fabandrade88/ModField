package logstore

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestAppendReadReopen(t *testing.T) {
	dir := t.TempDir()
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	l, err := s.Create(Meta{ID: "abc", Name: "teste", IntervalMs: 1000, StartedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
	t0 := time.UnixMilli(1_760_000_000_000)
	for i := 0; i < 1000; i++ {
		res := []Result{{Words: []uint16{uint16(i), 2, 3}}, {Error: "TIMEOUT"}}
		if i%100 == 0 {
			res[1] = Result{Error: "MODBUS_EXCEPTION", Exception: 2}
		}
		if _, err := l.Append(t0.Add(time.Duration(i)*time.Second), 12.5, res); err != nil {
			t.Fatal(err)
		}
	}
	recs, err := l.Read(500, 10)
	if err != nil || len(recs) != 10 || recs[0].Seq != 500 || recs[0].Results[0].Words[0] != 499 {
		t.Fatalf("read from 500: %+v %v", recs[:1], err)
	}
	if recs[0].Results[1].Error != "TIMEOUT" || recs[0].T != t0.Add(499*time.Second).UnixMilli() {
		t.Fatalf("record content: %+v", recs[0])
	}
	all, _ := l.Read(1, 5000)
	if len(all) != 1000 || all[100].Results[1].Exception != 2 {
		t.Fatalf("all: %d", len(all))
	}
	l.Close()

	// The agent restarts: everything is still there.
	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	l2 := s2.Get("abc")
	if l2 == nil || l2.Meta().LastSeq != 1000 || !l2.Meta().Running {
		t.Fatalf("reopen: %+v", l2)
	}
	rec, _ := l2.Append(t0.Add(2000*time.Second), 1, []Result{{Words: []uint16{7}}})
	if rec.Seq != 1001 {
		t.Fatalf("seq after reopen: %d", rec.Seq)
	}
}

func TestTornTailIsCutOff(t *testing.T) {
	dir := t.TempDir()
	s, _ := Open(dir)
	l, _ := s.Create(Meta{ID: "torn", StartedAt: time.Now()})
	for i := 0; i < 10; i++ {
		l.Append(time.Now(), 1, []Result{{Words: []uint16{uint16(i)}}})
	}
	l.Close()
	// Power loss in the middle of record 11.
	f, _ := os.OpenFile(filepath.Join(dir, "torn.mflog"), os.O_APPEND|os.O_WRONLY, 0)
	f.Write(encode(Record{Seq: 11, Results: []Result{{Words: []uint16{1, 2, 3}}}})[:15])
	f.Close()

	s2, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	l2 := s2.Get("torn")
	if l2.Meta().LastSeq != 10 {
		t.Fatalf("lastSeq %d", l2.Meta().LastSeq)
	}
	if rec, _ := l2.Append(time.Now(), 1, nil); rec.Seq != 11 {
		t.Fatalf("append after recovery: %d", rec.Seq)
	}
	if recs, _ := l2.Read(1, 100); len(recs) != 11 {
		t.Fatalf("records after recovery: %d", len(recs))
	}
}

func TestPrune(t *testing.T) {
	s, _ := Open(t.TempDir())
	l, _ := s.Create(Meta{ID: "old", StartedAt: time.Now()})
	l.Append(time.Now(), 1, nil)
	long := time.Now().Add(-40 * 24 * time.Hour)
	l.Update(func(m *Meta) { m.Running = false; m.StoppedAt = &long; m.AckedSeq = 0 })
	s.Prune(30 * 24 * time.Hour)
	if s.Get("old") == nil {
		t.Fatal("unacknowledged log pruned")
	}
	l.Update(func(m *Meta) { m.AckedSeq = 1 })
	s.Prune(30 * 24 * time.Hour)
	if s.Get("old") != nil {
		t.Fatal("acknowledged old log kept")
	}
}

func TestSize(t *testing.T) {
	// 50 FLOAT32 tags in 5 blocks of 20 registers: about 230 bytes per cycle.
	res := make([]Result, 5)
	for i := range res {
		res[i] = Result{Words: make([]uint16, 20)}
	}
	n := len(encode(Record{Results: res}))
	week := n * 7 * 24 * 3600
	if week > 200<<20 {
		t.Fatalf("7 days at 1 s would take %d MB", week>>20)
	}
}
