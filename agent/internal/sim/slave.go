// Package sim is the slave simulator: generators per register, a request
// log, and forced exceptions for tests. Its JSON configuration is the same
// shape as SimSlaveConfig in packages/transport.
package sim

import (
	"math"
	"math/rand/v2"
	"sync"
	"time"

	"modfield.dev/agent/internal/modbus"
)

// Generator produces a point's value over time since the slave started.
type Generator struct {
	Kind       string   `json:"kind"` // fixed, ramp, sine, random, counter
	Value      float64  `json:"value,omitempty"`
	Min        float64  `json:"min,omitempty"`
	Max        *float64 `json:"max,omitempty"`
	Offset     float64  `json:"offset,omitempty"`
	Amplitude  float64  `json:"amplitude,omitempty"`
	PeriodMs   float64  `json:"periodMs,omitempty"`
	Step       float64  `json:"step,omitempty"`
	IntervalMs float64  `json:"intervalMs,omitempty"`
}

// At mirrors generate() in packages/transport.
func (g Generator) At(ms float64, rnd func() float64) float64 {
	switch g.Kind {
	case "ramp":
		hi := 0.0
		if g.Max != nil {
			hi = *g.Max
		}
		return g.Min + math.Mod(ms, g.PeriodMs)/g.PeriodMs*(hi-g.Min)
	case "sine":
		return g.Offset + g.Amplitude*math.Sin(2*math.Pi*ms/g.PeriodMs)
	case "random":
		hi := 0.0
		if g.Max != nil {
			hi = *g.Max
		}
		return g.Min + rnd()*(hi-g.Min)
	case "counter":
		n := math.Floor(ms/g.IntervalMs) * g.Step
		if g.Max != nil {
			return math.Mod(n, *g.Max+1)
		}
		return n
	}
	return g.Value
}

// Point is one simulated value.
type Point struct {
	Table     string    `json:"table"` // coil, discrete, holding, input
	Address   uint16    `json:"address"`
	Type      string    `json:"type,omitempty"`
	Order     string    `json:"order,omitempty"`
	Generator Generator `json:"generator"`
	Text      string    `json:"text,omitempty"`
	Name      string    `json:"name,omitempty"`
	Unit      string    `json:"unit,omitempty"`
}

// SlaveConfig is one simulated device.
type SlaveConfig struct {
	UnitID   byte            `json:"unitId"`
	Name     string          `json:"name"`
	Points   []Point         `json:"points"`
	DeviceID map[byte]string `json:"deviceId,omitempty"`
	// Exceptions forces an exception code for reads that touch a holding address (tests, demos).
	Exceptions map[uint16]byte `json:"exceptions,omitempty"`
}

type slave struct {
	cfg    SlaveConfig
	regs   map[string]map[uint16]uint16
	owner  map[string]map[uint16]*Point
	frozen map[*Point]bool
}

// Bench is a set of slaves on one line or TCP server. It implements modbus.Handler.
type Bench struct {
	mu     sync.Mutex
	slaves map[byte]*slave
	start  time.Time
	now    func() time.Time
	rnd    func() float64
}

// NewBench builds a bench. now may be nil.
func NewBench(cfgs []SlaveConfig, now func() time.Time) *Bench {
	if now == nil {
		now = time.Now
	}
	b := &Bench{slaves: map[byte]*slave{}, now: now, rnd: rand.Float64}
	b.start = now()
	for i := range cfgs {
		c := cfgs[i]
		s := &slave{cfg: c, regs: map[string]map[uint16]uint16{}, owner: map[string]map[uint16]*Point{}, frozen: map[*Point]bool{}}
		for _, t := range []string{"coil", "discrete", "holding", "input"} {
			s.regs[t] = map[uint16]uint16{}
			s.owner[t] = map[uint16]*Point{}
		}
		for j := range s.cfg.Points {
			p := &s.cfg.Points[j]
			n := 1
			if p.Table == "holding" || p.Table == "input" {
				n = registerCount(typeOf(p), len(p.Text))
			}
			for k := 0; k < n; k++ {
				s.owner[p.Table][p.Address+uint16(k)] = p
				s.regs[p.Table][p.Address+uint16(k)] = 0
			}
		}
		b.slaves[c.UnitID] = s
	}
	return b
}

func typeOf(p *Point) string {
	if p.Type == "" {
		return "UINT16"
	}
	return p.Type
}

func (b *Bench) refresh(s *slave, table string, addr uint16, qty int) {
	seen := map[*Point]bool{}
	ms := float64(b.now().Sub(b.start).Milliseconds())
	for a := int(addr); a < int(addr)+qty; a++ {
		p := s.owner[table][uint16(a)]
		if p == nil || seen[p] || s.frozen[p] {
			continue
		}
		seen[p] = true
		if table == "coil" || table == "discrete" {
			v := uint16(0)
			if p.Generator.At(ms, b.rnd) >= 0.5 {
				v = 1
			}
			s.regs[table][p.Address] = v
			continue
		}
		var regs []uint16
		if typeOf(p) == "STRING" {
			regs = encodeText(p.Text, p.Order)
		} else {
			regs = encode(p.Generator.At(ms, b.rnd), typeOf(p), p.Order)
		}
		for i, r := range regs {
			s.regs[table][p.Address+uint16(i)] = r
		}
	}
}

func (s *slave) covered(table string, addr uint16, qty int) bool {
	for a := int(addr); a < int(addr)+qty; a++ {
		if _, ok := s.regs[table][uint16(a)]; !ok {
			return false
		}
	}
	return true
}

var tableOf = map[byte]string{
	modbus.FcReadCoils: "coil", modbus.FcReadDiscrete: "discrete", modbus.FcReadHolding: "holding", modbus.FcReadInput: "input",
	modbus.FcWriteCoil: "coil", modbus.FcWriteCoils: "coil", modbus.FcWriteRegister: "holding", modbus.FcWriteRegisters: "holding",
}

// Handle implements modbus.Handler. Unknown units stay silent.
func (b *Bench) Handle(unit byte, pdu []byte) ([]byte, bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	s := b.slaves[unit]
	if s == nil {
		return nil, false
	}
	req, err := modbus.DecodeRequest(pdu)
	if err != nil {
		code := modbus.ExIllegalFunction
		if len(pdu) > 0 && (tableOf[pdu[0]] != "" || pdu[0] == modbus.FcEncapsulated) {
			code = modbus.ExIllegalValue
		}
		fc := byte(0)
		if len(pdu) > 0 {
			fc = pdu[0]
		}
		return modbus.ExceptionPDU(fc, code), true
	}
	return b.execute(s, req), true
}

func (b *Bench) execute(s *slave, req *modbus.Request) []byte {
	ex := func(code byte) []byte { return modbus.ExceptionPDU(req.Fc, code) }
	table := tableOf[req.Fc]
	switch req.Fc {
	case modbus.FcReadCoils, modbus.FcReadDiscrete, modbus.FcReadHolding, modbus.FcReadInput:
		if req.Fc == modbus.FcReadHolding {
			for a := int(req.Address); a < int(req.Address)+int(req.Quantity); a++ {
				if code, ok := s.cfg.Exceptions[uint16(a)]; ok {
					return ex(code)
				}
			}
		}
		if !s.covered(table, req.Address, int(req.Quantity)) {
			return ex(modbus.ExIllegalAddress)
		}
		b.refresh(s, table, req.Address, int(req.Quantity))
		res := &modbus.Response{Fc: req.Fc}
		for i := 0; i < int(req.Quantity); i++ {
			v := s.regs[table][req.Address+uint16(i)]
			if table == "coil" || table == "discrete" {
				res.Bits = append(res.Bits, v == 1)
			} else {
				res.Registers = append(res.Registers, v)
			}
		}
		return modbus.EncodeResponse(res)
	case modbus.FcWriteCoil, modbus.FcWriteRegister:
		if !s.covered(table, req.Address, 1) {
			return ex(modbus.ExIllegalAddress)
		}
		b.freeze(s, table, req.Address, 1)
		v := req.Value
		if req.Fc == modbus.FcWriteCoil && v == 0xFF00 {
			v = 1
		}
		s.regs[table][req.Address] = v
		return modbus.EncodeResponse(&modbus.Response{Fc: req.Fc, Address: req.Address, Value: req.Value})
	case modbus.FcWriteCoils, modbus.FcWriteRegisters:
		n := len(req.Values)
		if req.Fc == modbus.FcWriteCoils {
			n = len(req.Bits)
		}
		if !s.covered(table, req.Address, n) {
			return ex(modbus.ExIllegalAddress)
		}
		b.freeze(s, table, req.Address, n)
		for i := 0; i < n; i++ {
			v := uint16(0)
			if req.Fc == modbus.FcWriteCoils {
				if req.Bits[i] {
					v = 1
				}
			} else {
				v = req.Values[i]
			}
			s.regs[table][req.Address+uint16(i)] = v
		}
		return modbus.EncodeResponse(&modbus.Response{Fc: req.Fc, Address: req.Address, Quantity: uint16(n)})
	case modbus.FcEncapsulated:
		if s.cfg.DeviceID == nil {
			return ex(modbus.ExIllegalFunction)
		}
		maxID := map[byte]int{1: 0x02, 2: 0x7F, 3: 0xFF, 4: 0xFF}[req.ReadCode]
		objs := map[byte]string{}
		for id, v := range s.cfg.DeviceID {
			if (req.ReadCode == 4 && id == req.ObjectID) || (req.ReadCode != 4 && id >= req.ObjectID && int(id) <= maxID) {
				objs[id] = v
			}
		}
		if len(objs) == 0 {
			return ex(modbus.ExIllegalAddress)
		}
		return modbus.EncodeResponse(&modbus.Response{Fc: req.Fc, ReadCode: req.ReadCode, Conformity: 1, Objects: objs})
	}
	return ex(modbus.ExIllegalFunction)
}

func (b *Bench) freeze(s *slave, table string, addr uint16, n int) {
	for a := int(addr); a < int(addr)+n; a++ {
		if p := s.owner[table][uint16(a)]; p != nil && !s.frozen[p] {
			b.refresh(s, table, p.Address, 1)
			s.frozen[p] = true
		}
	}
}
