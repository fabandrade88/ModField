package agent

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net"
	"time"

	"go.bug.st/serial"

	"modfield.dev/agent/internal/modbus"
	"modfield.dev/agent/internal/sim"
)

type simRun struct {
	id     string
	label  string
	addr   string
	tcp    *modbus.TCPServer
	port   serial.Port
	owners map[*Session]bool
}

// SimSummary is one entry of sim.list.
type SimSummary struct {
	SimID string `json:"simId"`
	Label string `json:"label"`
	Addr  string `json:"addr,omitempty"`
}

func (a *Agent) simStart(s *Session, raw json.RawMessage) (any, error) {
	p, err := decode[struct {
		Transport string            `json:"transport"` // tcp | rtu
		Listen    string            `json:"listen,omitempty"`
		AllowLAN  bool              `json:"allowLan,omitempty"`
		Slaves    []sim.SlaveConfig `json:"slaves,omitempty"`
		Port      string            `json:"port,omitempty"`
		BaudRate  int               `json:"baudRate,omitempty"`
		Parity    string            `json:"parity,omitempty"`
		StopBits  int               `json:"stopBits,omitempty"`
	}](raw)
	if err != nil {
		return nil, err
	}
	slaves := p.Slaves
	if len(slaves) == 0 {
		slaves = sim.Demo()
	}
	run := &simRun{id: newID(), owners: map[*Session]bool{}}
	if s != nil {
		run.owners[s] = true
	}
	logReq := func(t time.Time, unit byte, pdu, resp []byte) {
		ev := map[string]any{"simId": run.id, "t": t.UnixMilli(), "unitId": unit, "pdu": hex.EncodeToString(pdu), "response": hex.EncodeToString(resp)}
		a.mu.Lock()
		owners := make([]*Session, 0, len(run.owners))
		for o := range run.owners {
			owners = append(owners, o)
		}
		a.mu.Unlock()
		for _, o := range owners {
			o.notify("sim.request", ev)
		}
	}
	bench := sim.NewBench(slaves, nil)

	switch p.Transport {
	case "tcp", "":
		addr := p.Listen
		if addr == "" {
			addr = "127.0.0.1:5020"
		}
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			return nil, badParams("listen must be host:port")
		}
		// Off-loopback triggers the Windows firewall (admin) and exposes the simulator: opt-in only.
		if ip := net.ParseIP(host); (ip == nil || !ip.IsLoopback()) && !p.AllowLAN {
			return nil, badParams("listening outside 127.0.0.1 needs allowLan")
		}
		srv := &modbus.TCPServer{Handler: bench, Log: logReq}
		if err := srv.Listen(addr); err != nil {
			return nil, &modbus.Error{Code: modbus.ErrPortBusy, Msg: err.Error()}
		}
		run.tcp, run.addr, run.label = srv, srv.Addr(), "TCP "+srv.Addr()
	case "rtu":
		mode := &serial.Mode{BaudRate: p.BaudRate, DataBits: 8, Parity: serial.NoParity, StopBits: serial.OneStopBit}
		switch p.Parity {
		case "even":
			mode.Parity = serial.EvenParity
		case "odd":
			mode.Parity = serial.OddParity
		}
		if p.StopBits == 2 {
			mode.StopBits = serial.TwoStopBits
		}
		port, err := serial.Open(p.Port, mode)
		if err != nil {
			return nil, serialError(p.Port, err)
		}
		run.port, run.label = port, fmt.Sprintf("RTU %s %d", p.Port, p.BaudRate)
		go func() { _ = (&modbus.RTUServer{Port: port, Handler: bench, Log: logReq}).Serve() }()
	default:
		return nil, badParams("transport must be tcp or rtu")
	}
	a.mu.Lock()
	a.sims[run.id] = run
	a.mu.Unlock()
	a.Log.Info("simulator started", "sim", run.id, "label", run.label)
	return SimSummary{SimID: run.id, Label: run.label, Addr: run.addr}, nil
}

func (a *Agent) simStop(raw json.RawMessage) (any, error) {
	p, err := decode[struct{ SimID string `json:"simId"` }](raw)
	if err != nil {
		return nil, err
	}
	a.mu.Lock()
	run := a.sims[p.SimID]
	delete(a.sims, p.SimID)
	a.mu.Unlock()
	if run != nil {
		if run.tcp != nil {
			_ = run.tcp.Close()
		}
		if run.port != nil {
			_ = run.port.Close()
		}
	}
	return nil, nil
}

func (a *Agent) simList() []SimSummary {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := []SimSummary{}
	for _, r := range a.sims {
		out = append(out, SimSummary{SimID: r.id, Label: r.label, Addr: r.addr})
	}
	return out
}

// StartDemoSim starts the demo bench on a TCP address at boot (--sim), for
// demos and automated tests without equipment.
func (a *Agent) StartDemoSim(addr string) (SimSummary, error) {
	raw, _ := json.Marshal(map[string]string{"transport": "tcp", "listen": addr})
	r, err := a.simStart(nil, raw)
	if err != nil {
		return SimSummary{}, err
	}
	return r.(SimSummary), nil
}
