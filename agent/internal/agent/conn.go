package agent

import (
	"fmt"
	"strings"
	"sync"
	"time"

	"go.bug.st/serial"

	"modfield.dev/agent/internal/modbus"
)

// SerialPortInfo is one entry of serial.list.
type SerialPortInfo struct {
	Name         string `json:"name"`
	IsUSB        bool   `json:"isUsb"`
	VID          string `json:"vid,omitempty"`
	PID          string `json:"pid,omitempty"`
	Product      string `json:"product,omitempty"`
	SerialNumber string `json:"serialNumber,omitempty"`
}

// OpenParams is conn.open.
type OpenParams struct {
	Kind string `json:"kind"` // rtu | tcp
	// RTU
	Port                string `json:"port,omitempty"`
	BaudRate            int    `json:"baudRate,omitempty"`
	DataBits            int    `json:"dataBits,omitempty"`
	Parity              string `json:"parity,omitempty"`
	StopBits            int    `json:"stopBits,omitempty"`
	InterRequestDelayMs int    `json:"interRequestDelayMs,omitempty"`
	// TCP
	Host    string `json:"host,omitempty"`
	TCPPort int    `json:"tcpPort,omitempty"`
}

func (p OpenParams) label() string {
	if p.Kind == "tcp" {
		return fmt.Sprintf("TCP %s:%d", p.Host, p.TCPPort)
	}
	return fmt.Sprintf("RTU %s %d %d%s%d", p.Port, p.BaudRate, p.DataBits, strings.ToUpper(p.Parity[:1]), p.StopBits)
}

type doer interface {
	Do(unit byte, req *modbus.Request, timeout time.Duration) (*modbus.Response, error)
	Close() error
}

// Stats mirrors TransportStats in packages/transport.
type Stats struct {
	Requests   int      `json:"requests"`
	Timeouts   int      `json:"timeouts"`
	CRCErrors  int      `json:"crcErrors"`
	Exceptions int      `json:"exceptions"`
	Errors     int      `json:"errors"`
	LastRTTMs  *float64 `json:"lastRttMs"`
}

// Conn is an open RTU or TCP connection, shared by sessions through leases.
type Conn struct {
	ID     string
	Params OpenParams
	Label  string
	client doer

	mu      sync.Mutex
	stats   Stats
	// broken is set when the link drops (socket closed, USB unplugged); the
	// next request reopens it first. The request that failed is never retried.
	broken  bool
	onFrame func(c *Conn, f modbus.Frame)
	taps    map[*Session]bool
	leases  map[*Session]bool
	pinned  int // running logs keep the connection open with no session
	closeAt *time.Timer
}

func openConn(id string, p OpenParams, onFrame func(c *Conn, f modbus.Frame)) (*Conn, error) {
	c := &Conn{ID: id, Params: p, Label: p.label(), taps: map[*Session]bool{}, leases: map[*Session]bool{}, onFrame: onFrame}
	tap := func(f modbus.Frame) { onFrame(c, f) }
	switch p.Kind {
	case "tcp":
		if p.Host == "" || p.TCPPort <= 0 || p.TCPPort > 65535 {
			return nil, badParams("tcp needs host and tcpPort")
		}
		cl, err := modbus.DialTCP(fmt.Sprintf("%s:%d", p.Host, p.TCPPort), 3*time.Second, tap)
		if err != nil {
			return nil, err
		}
		c.client = cl
	case "rtu":
		if p.Port == "" || p.BaudRate <= 0 {
			return nil, badParams("rtu needs port and baudRate")
		}
		mode := &serial.Mode{BaudRate: p.BaudRate, DataBits: p.DataBits, StopBits: serial.OneStopBit, Parity: serial.NoParity}
		if mode.DataBits == 0 {
			mode.DataBits = 8
		}
		if p.StopBits == 2 {
			mode.StopBits = serial.TwoStopBits
		}
		switch p.Parity {
		case "even":
			mode.Parity = serial.EvenParity
		case "odd":
			mode.Parity = serial.OddParity
		}
		port, err := serial.Open(p.Port, mode)
		if err != nil {
			return nil, serialError(p.Port, err)
		}
		bits := 1 + mode.DataBits + 1
		if mode.Parity != serial.NoParity {
			bits++
		}
		if mode.StopBits == serial.TwoStopBits {
			bits++
		}
		c.client = &modbus.RTUClient{
			Port:     port,
			CharTime: modbus.CharTimeFor(p.BaudRate, bits),
			Delay:    time.Duration(p.InterRequestDelayMs) * time.Millisecond,
			Tap:      tap,
		}
	default:
		return nil, badParams("kind must be rtu or tcp")
	}
	return c, nil
}

func serialError(name string, err error) error {
	if pe, ok := err.(*serial.PortError); ok {
		switch pe.Code() {
		case serial.PortBusy:
			return &modbus.Error{Code: modbus.ErrPortBusy, Msg: fmt.Sprintf("%s is in use by another program", name)}
		case serial.PermissionDenied:
			return &permissionError{msg: fmt.Sprintf("no permission to open %s", name), group: deviceGroup(name)}
		case serial.PortNotFound:
			return &modbus.Error{Code: modbus.ErrPortDisconnected, Msg: fmt.Sprintf("%s not found", name)}
		}
	}
	return &modbus.Error{Code: modbus.ErrPortDisconnected, Msg: err.Error()}
}

// Do runs one request and counts it, like WebSerialTransport.count. A read
// that finds the link already dead (the slave restarted, the socket was
// closed) reconnects and runs once more: reads are safe to repeat. Writes are
// never repeated, whatever happened.
func (c *Conn) Do(unit byte, req *modbus.Request, timeout time.Duration) (*modbus.Response, error) {
	res, err := c.do(unit, req, timeout)
	if me, ok := err.(*modbus.Error); ok && me.Code == modbus.ErrPortDisconnected && !req.IsWrite() && c.onFrame != nil {
		if c.Reopen(c.onFrame) == nil {
			return c.do(unit, req, timeout)
		}
	}
	return res, err
}

func (c *Conn) do(unit byte, req *modbus.Request, timeout time.Duration) (*modbus.Response, error) {
	c.mu.Lock()
	broken := c.broken || c.client == nil
	c.mu.Unlock()
	if broken && c.onFrame != nil {
		// Reconnect before a new request (automatic reconnection after a drop).
		if err := c.Reopen(c.onFrame); err != nil {
			return nil, err
		}
	}
	start := time.Now()
	c.mu.Lock()
	client := c.client
	c.mu.Unlock()
	if client == nil {
		return nil, &modbus.Error{Code: modbus.ErrPortDisconnected, Msg: "reconnecting"}
	}
	res, err := client.Do(unit, req, timeout)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.stats.Requests++
	rtt := float64(time.Since(start).Microseconds()) / 1000
	c.stats.LastRTTMs = &rtt
	if me, ok := err.(*modbus.Error); ok {
		if me.Code == modbus.ErrPortDisconnected {
			c.broken = true
		}
		switch me.Code {
		case modbus.ErrTimeout:
			c.stats.Timeouts++
		case modbus.ErrCRC:
			c.stats.CRCErrors++
		case modbus.ErrException:
			c.stats.Exceptions++
		default:
			c.stats.Errors++
		}
	} else if err != nil {
		c.stats.Errors++
	}
	return res, err
}

// Reopen replaces a lost client (USB unplugged and plugged back, TCP dropped).
func (c *Conn) Reopen(onFrame func(c *Conn, f modbus.Frame)) error {
	c.mu.Lock()
	old := c.client
	c.client = nil
	c.mu.Unlock()
	if old != nil {
		_ = old.Close()
	}
	fresh, err := openConn(c.ID, c.Params, onFrame)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.client = fresh.client
	c.broken = false
	c.onFrame = onFrame
	c.mu.Unlock()
	return nil
}

// Stats returns a copy of the counters.
func (c *Conn) Stats() Stats {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.stats
}
