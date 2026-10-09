package agent

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net"
	"sync"
	"time"

	"modfield.dev/agent/internal/modbus"
)

// ScanHit is one device that answered.
type ScanHit struct {
	IP        string `json:"ip,omitempty"`
	UnitID    byte   `json:"unitId"`
	Answer    string `json:"answer"` // ok | exception
	Exception byte   `json:"exception,omitempty"`
}

var probe = modbus.Request{Fc: modbus.FcReadHolding, Address: 0, Quantity: 1}

func probeUnit(d interface {
	Do(byte, *modbus.Request, time.Duration) (*modbus.Response, error)
}, ip string, unit byte, to time.Duration) (*ScanHit, error) {
	req := probe
	_, err := d.Do(unit, &req, to)
	if err == nil {
		return &ScanHit{IP: ip, UnitID: unit, Answer: "ok"}, nil
	}
	if me, ok := err.(*modbus.Error); ok {
		switch me.Code {
		case modbus.ErrException:
			return &ScanHit{IP: ip, UnitID: unit, Answer: "exception", Exception: me.Exception}, nil
		case modbus.ErrPortDisconnected:
			return nil, err
		}
	}
	return nil, nil
}

// Limits for IP scans: old devices and corporate EDRs do not like bursts.
const (
	ipScanConcurrency = 10
	ipScanPerSecond   = 20
	ipScanMaxHosts    = 1024
)

func ipRange(from, to string) ([]string, error) {
	a, b := net.ParseIP(from).To4(), net.ParseIP(to).To4()
	if a == nil || b == nil {
		return nil, badParams("from and to must be IPv4 addresses")
	}
	x, y := binary.BigEndian.Uint32(a), binary.BigEndian.Uint32(b)
	if y < x || y-x >= ipScanMaxHosts {
		return nil, badParams(fmt.Sprintf("range must be ascending and at most %d hosts", ipScanMaxHosts))
	}
	out := make([]string, 0, y-x+1)
	for i := x; i <= y; i++ {
		out = append(out, net.IPv4(byte(i>>24), byte(i>>16), byte(i>>8), byte(i)).String())
	}
	return out, nil
}

type scanParams struct {
	Kind      string `json:"kind"` // ids | ip
	ConnID    string `json:"connId,omitempty"`
	IDs       []int  `json:"ids,omitempty"`
	From      string `json:"from,omitempty"`
	To        string `json:"to,omitempty"`
	Port      int    `json:"port,omitempty"`
	UnitIDs   []int  `json:"unitIds,omitempty"`
	TimeoutMs int    `json:"timeoutMs"`
}

func (a *Agent) scanStart(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[scanParams](raw)
	if err != nil {
		return nil, err
	}
	to := timeout(p.TimeoutMs)
	ctx, cancel := context.WithCancel(context.Background())
	id := newID()
	var run func() []ScanHit

	switch p.Kind {
	case "ids":
		c, err := a.conn(p.ConnID)
		if err != nil {
			cancel()
			return nil, err
		}
		if len(p.IDs) == 0 {
			cancel()
			return nil, badParams("ids is empty")
		}
		run = func() []ScanHit {
			hits := []ScanHit{}
			for i, unit := range p.IDs {
				if ctx.Err() != nil {
					break
				}
				if unit < 1 || unit > 247 {
					continue
				}
				if h, err := probeUnit(c, "", byte(unit), to); err != nil {
					break
				} else if h != nil {
					hits = append(hits, *h)
				}
				s.notify("scan.progress", map[string]any{"scanId": id, "done": i + 1, "total": len(p.IDs), "label": fmt.Sprintf("ID %d", unit), "hits": hits})
			}
			return hits
		}
	case "ip":
		ips, err := ipRange(p.From, p.To)
		if err != nil {
			cancel()
			return nil, err
		}
		port := p.Port
		if port == 0 {
			port = 502
		}
		units := []byte{}
		for _, u := range p.UnitIDs {
			if u >= 0 && u <= 255 {
				units = append(units, byte(u))
			}
		}
		if len(units) == 0 {
			units = []byte{1}
		}
		run = func() []ScanHit {
			var (
				mu    sync.Mutex
				hits  = []ScanHit{}
				done  int
				wg    sync.WaitGroup
				sem   = make(chan struct{}, ipScanConcurrency)
				ticks = time.NewTicker(time.Second / ipScanPerSecond)
			)
			defer ticks.Stop()
			for _, ip := range ips {
				select {
				case <-ctx.Done():
				case <-ticks.C:
				}
				if ctx.Err() != nil {
					break
				}
				sem <- struct{}{}
				wg.Add(1)
				go func(ip string) {
					defer func() { <-sem; wg.Done() }()
					var found []ScanHit
					if cl, err := modbus.DialTCP(fmt.Sprintf("%s:%d", ip, port), to, nil); err == nil {
						for _, u := range units {
							if h, _ := probeUnit(cl, ip, u, to); h != nil {
								found = append(found, *h)
							}
						}
						cl.Close()
					}
					mu.Lock()
					hits = append(hits, found...)
					done++
					snapshot := append([]ScanHit{}, hits...) // never null in JSON
					d := done
					mu.Unlock()
					s.notify("scan.progress", map[string]any{"scanId": id, "done": d, "total": len(ips), "label": ip, "hits": snapshot})
				}(ip)
			}
			wg.Wait()
			return hits
		}
	default:
		cancel()
		return nil, badParams("kind must be ids or ip")
	}

	a.mu.Lock()
	a.scans[id] = cancel
	a.mu.Unlock()
	go func() {
		hits := run()
		a.mu.Lock()
		delete(a.scans, id)
		a.mu.Unlock()
		cancel()
		s.notify("scan.done", map[string]any{"scanId": id, "hits": hits})
	}()
	return map[string]string{"scanId": id}, nil
}
