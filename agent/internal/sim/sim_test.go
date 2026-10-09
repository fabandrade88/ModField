package sim

import (
	"errors"
	"io"
	"math"
	"net"
	"sync"
	"testing"
	"time"

	"modfield.dev/agent/internal/modbus"
)

// pipePort turns one end of net.Pipe into a serial-like port: reads time out with (0, nil).
type pipePort struct {
	net.Conn
	timeout time.Duration
}

func (p *pipePort) SetReadTimeout(d time.Duration) error { p.timeout = d; return nil }
func (p *pipePort) Read(b []byte) (int, error) {
	_ = p.Conn.SetReadDeadline(time.Now().Add(p.timeout))
	n, err := p.Conn.Read(b)
	var ne net.Error
	if errors.As(err, &ne) && ne.Timeout() {
		return n, nil
	}
	return n, err
}

// chunked delivers writes a few bytes at a time, like a USB converter.
type chunked struct {
	net.Conn
}

func (c chunked) Write(b []byte) (int, error) {
	for i := 0; i < len(b); i += 3 {
		if _, err := c.Conn.Write(b[i:min(i+3, len(b))]); err != nil {
			return i, err
		}
	}
	return len(b), nil
}

func demoTCP(t *testing.T) (*modbus.TCPClient, func()) {
	t.Helper()
	cfgs := Demo()
	// Forced exceptions at holding 200.. of slave 1, one per defined code.
	cfgs[0].Exceptions = map[uint16]byte{}
	for i, code := range []byte{1, 2, 3, 4, 5, 6, 8, 0x0A, 0x0B} {
		cfgs[0].Exceptions[uint16(200+i)] = code
	}
	srv := &modbus.TCPServer{Handler: NewBench(cfgs, nil)}
	if err := srv.Listen("127.0.0.1:0"); err != nil {
		t.Fatal(err)
	}
	c, err := modbus.DialTCP(srv.Addr(), time.Second, nil)
	if err != nil {
		t.Fatal(err)
	}
	return c, func() { c.Close(); srv.Close() }
}

func TestTCPAllFunctions(t *testing.T) {
	c, done := demoTCP(t)
	defer done()
	to := 500 * time.Millisecond

	res, err := c.Do(1, &modbus.Request{Fc: modbus.FcReadHolding, Address: 0, Quantity: 2}, to)
	if err != nil || res.Registers[0] != 1 || res.Registers[1] != 4500 {
		t.Fatalf("03: %+v %v", res, err)
	}
	res, err = c.Do(1, &modbus.Request{Fc: modbus.FcReadInput, Address: 0, Quantity: 5}, to)
	if err != nil || len(res.Registers) != 5 || math.Abs(float64(res.Registers[0])-4500) > 31 {
		t.Fatalf("04: %+v %v", res, err)
	}
	res, err = c.Do(1, &modbus.Request{Fc: modbus.FcReadCoils, Address: 0, Quantity: 1}, to)
	if err != nil || !res.Bits[0] {
		t.Fatalf("01: %+v %v", res, err)
	}
	res, err = c.Do(1, &modbus.Request{Fc: modbus.FcReadDiscrete, Address: 0, Quantity: 1}, to)
	if err != nil || res.Bits[0] {
		t.Fatalf("02: %+v %v", res, err)
	}
	if _, err := c.Do(1, &modbus.Request{Fc: modbus.FcWriteRegister, Address: 1, Value: 5000}, to); err != nil {
		t.Fatalf("06: %v", err)
	}
	if _, err := c.Do(1, &modbus.Request{Fc: modbus.FcWriteCoil, Address: 0, Value: 0}, to); err != nil {
		t.Fatalf("05: %v", err)
	}
	if _, err := c.Do(3, &modbus.Request{Fc: modbus.FcWriteRegisters, Address: 100, Values: []uint16{0x422A, 0}}, to); err != nil {
		t.Fatalf("16: %v", err)
	}
	if _, err := c.Do(1, &modbus.Request{Fc: modbus.FcWriteCoils, Address: 0, Bits: []bool{true}}, to); err != nil {
		t.Fatalf("15: %v", err)
	}
	res, _ = c.Do(1, &modbus.Request{Fc: modbus.FcReadHolding, Address: 1, Quantity: 1}, to)
	if res.Registers[0] != 5000 {
		t.Fatalf("written value not kept: %v", res.Registers)
	}
	res, _ = c.Do(3, &modbus.Request{Fc: modbus.FcReadHolding, Address: 100, Quantity: 2}, to)
	if math.Float32frombits(uint32(res.Registers[0])<<16|uint32(res.Registers[1])) != 42.5 {
		t.Fatalf("FLOAT32 write not kept: %v", res.Registers)
	}
	res, err = c.Do(1, &modbus.Request{Fc: modbus.FcEncapsulated, ReadCode: 2}, to)
	if err != nil || res.Objects[5] != "INV-7.5" || res.Objects[0] != "ModField" {
		t.Fatalf("43/14: %+v %v", res, err)
	}
}

func TestTCPEveryExceptionCode(t *testing.T) {
	c, done := demoTCP(t)
	defer done()
	for i, want := range []byte{1, 2, 3, 4, 5, 6, 8, 0x0A, 0x0B} {
		_, err := c.Do(1, &modbus.Request{Fc: modbus.FcReadHolding, Address: uint16(200 + i), Quantity: 1}, time.Second)
		var me *modbus.Error
		if !errors.As(err, &me) || me.Code != modbus.ErrException || me.Exception != want {
			t.Errorf("code %02X: got %v", want, err)
		}
	}
	// Unmapped address and missing device identification.
	_, err := c.Do(1, &modbus.Request{Fc: modbus.FcReadHolding, Address: 50, Quantity: 1}, time.Second)
	if me := err.(*modbus.Error); me.Exception != 2 {
		t.Errorf("unmapped: %v", err)
	}
	_, err = c.Do(3, &modbus.Request{Fc: modbus.FcEncapsulated, ReadCode: 1}, time.Second)
	if me := err.(*modbus.Error); me.Exception != 1 {
		t.Errorf("no 43/14: %v", err)
	}
}

func TestTCPTimeoutOnMissingUnit(t *testing.T) {
	c, done := demoTCP(t)
	defer done()
	_, err := c.Do(9, &modbus.Request{Fc: modbus.FcReadHolding, Quantity: 1}, 100*time.Millisecond)
	if me, ok := err.(*modbus.Error); !ok || me.Code != modbus.ErrTimeout {
		t.Fatalf("got %v", err)
	}
}

func TestRTUOverChunkedLine(t *testing.T) {
	a, b := net.Pipe()
	srv := &modbus.RTUServer{Port: chunked{b}, Handler: NewBench(Demo(), nil)}
	var wg sync.WaitGroup
	wg.Add(1)
	go func() { defer wg.Done(); _ = srv.Serve() }()

	var frames []modbus.Frame
	var mu sync.Mutex
	c := &modbus.RTUClient{
		Port:     &pipePort{Conn: a},
		CharTime: modbus.CharTimeFor(115200, 11),
		Tap: func(f modbus.Frame) {
			mu.Lock()
			frames = append(frames, f)
			mu.Unlock()
		},
	}
	res, err := c.Do(2, &modbus.Request{Fc: modbus.FcReadHolding, Address: 10, Quantity: 8}, 500*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	text := make([]byte, 0, 16)
	for _, r := range res.Registers {
		text = append(text, byte(r>>8), byte(r))
	}
	if string(text[:15]) != "PT-101 RECALQUE" {
		t.Fatalf("got %q", text)
	}
	_, err = c.Do(9, &modbus.Request{Fc: modbus.FcReadHolding, Quantity: 1}, 80*time.Millisecond)
	if me, ok := err.(*modbus.Error); !ok || me.Code != modbus.ErrTimeout {
		t.Fatalf("missing unit: %v", err)
	}
	mu.Lock()
	if len(frames) < 4 || frames[0].Dir != "tx" || frames[1].Dir != "rx" || frames[3].Error != modbus.ErrTimeout {
		t.Fatalf("tap: %+v", frames)
	}
	mu.Unlock()
	a.Close()
	b.Close()
	wg.Wait()
}

func TestRTUServerIgnoresBadCRC(t *testing.T) {
	a, b := net.Pipe()
	srv := &modbus.RTUServer{Port: b, Handler: NewBench(Demo(), nil)}
	go func() { _ = srv.Serve() }()
	frame := modbus.WithCRC([]byte{1, 3, 0, 0, 0, 1})
	frame[len(frame)-1] ^= 0xFF
	go func() { _, _ = a.Write(frame) }()
	_ = a.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	if n, err := a.Read(make([]byte, 16)); n != 0 || err == nil || errors.Is(err, io.EOF) {
		t.Fatalf("a slave must stay silent on a bad CRC: n=%d err=%v", n, err)
	}
	a.Close()
	b.Close()
}
