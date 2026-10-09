package agent

import (
	"encoding/json"
	"time"

	"modfield.dev/agent/internal/modbus"
)

// Block is one read of a plan made by the browser (planReads in packages/protocol).
// The agent reads raw words; decoding and scaling stay in TypeScript, one source of truth.
type Block struct {
	UnitID   byte   `json:"unitId"`
	Table    string `json:"table"`
	Offset   uint16 `json:"offset"`
	Quantity uint16 `json:"quantity"`
}

func (b Block) request() *modbus.Request {
	fc := map[string]byte{"coil": modbus.FcReadCoils, "discrete": modbus.FcReadDiscrete, "holding": modbus.FcReadHolding, "input": modbus.FcReadInput}[b.Table]
	return &modbus.Request{Fc: fc, Address: b.Offset, Quantity: b.Quantity}
}

// BlockError is why a block failed.
type BlockError struct {
	Code      modbus.Code `json:"code"`
	Exception byte        `json:"exception,omitempty"`
}

// BlockResult is the outcome of one block in a cycle.
type BlockResult struct {
	Words []uint16    `json:"words,omitempty"`
	Error *BlockError `json:"error,omitempty"`
}

// Cycle is one poll.cycle notification.
type Cycle struct {
	PollID  string        `json:"pollId"`
	T       int64         `json:"t"`
	CycleMs float64       `json:"cycleMs"`
	Results []BlockResult `json:"results"`
}

type poll struct {
	id       string
	owner    *Session
	conn     *Conn
	blocks   []Block
	interval time.Duration
	timeout  time.Duration
	stop     chan struct{}
	// onCycle receives every cycle besides the owner (the logger, phase 4).
	onCycle func(Cycle)
}

func readBlocks(c *Conn, blocks []Block, to time.Duration) []BlockResult {
	out := make([]BlockResult, len(blocks))
	for i, b := range blocks {
		req := b.request()
		if req.Fc == 0 {
			out[i].Error = &BlockError{Code: modbus.ErrInvalidResponse}
			continue
		}
		res, err := c.Do(b.UnitID, req, to)
		if err != nil {
			code, ex := modbus.ErrInvalidResponse, byte(0)
			if me, ok := err.(*modbus.Error); ok {
				code, ex = me.Code, me.Exception
			}
			out[i].Error = &BlockError{code, ex}
			if code == modbus.ErrPortDisconnected {
				break
			}
			continue
		}
		if res.Bits != nil {
			out[i].Words = make([]uint16, len(res.Bits))
			for j, bit := range res.Bits {
				if bit {
					out[i].Words[j] = 1
				}
			}
		} else {
			out[i].Words = res.Registers
		}
	}
	return out
}

// run cycles until stopped. The next cycle is scheduled from the start of the
// previous one, so delays never accumulate (the same rule as Poller in TS).
func (p *poll) run() {
	for {
		start := time.Now()
		results := readBlocks(p.conn, p.blocks, p.timeout)
		cyc := Cycle{PollID: p.id, T: start.UnixMilli(), CycleMs: float64(time.Since(start).Microseconds()) / 1000, Results: results}
		if p.owner != nil {
			p.owner.notify("poll.cycle", cyc)
		}
		if p.onCycle != nil {
			p.onCycle(cyc)
		}
		wait := p.interval - time.Since(start)
		select {
		case <-p.stop:
			return
		case <-time.After(max(wait, 0)):
		}
	}
}

func (a *Agent) pollStart(s *Session, raw json.RawMessage) (any, error) {
	in, err := decode[struct {
		ConnID     string  `json:"connId"`
		Blocks     []Block `json:"blocks"`
		IntervalMs int     `json:"intervalMs"`
		TimeoutMs  int     `json:"timeoutMs"`
	}](raw)
	if err != nil {
		return nil, err
	}
	if len(in.Blocks) == 0 || len(in.Blocks) > 500 {
		return nil, badParams("1..500 blocks")
	}
	if in.IntervalMs < 100 || in.IntervalMs > 60000 {
		return nil, badParams("intervalMs must be 100..60000")
	}
	c, err := a.conn(in.ConnID)
	if err != nil {
		return nil, err
	}
	p := &poll{id: newID(), owner: s, conn: c, blocks: in.Blocks, interval: time.Duration(in.IntervalMs) * time.Millisecond, timeout: timeout(in.TimeoutMs), stop: make(chan struct{})}
	a.mu.Lock()
	a.polls[p.id] = p
	a.mu.Unlock()
	go p.run()
	return map[string]string{"pollId": p.id}, nil
}

func (a *Agent) stopPoll(id string) {
	a.mu.Lock()
	p := a.polls[id]
	delete(a.polls, id)
	a.mu.Unlock()
	if p != nil {
		close(p.stop)
	}
}
