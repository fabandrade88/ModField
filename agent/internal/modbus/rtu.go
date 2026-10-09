package modbus

import (
	"errors"
	"io"
	"sync"
	"time"
)

// RTUResponseLength is the total length of a response frame given the bytes
// received so far: -1 means more bytes are needed, -2 means the bytes cannot
// start a valid response.
func RTUResponseLength(b []byte) int {
	if len(b) < 2 {
		return -1
	}
	fc := b[1]
	if fc&0x80 != 0 {
		return 5
	}
	switch fc {
	case FcReadCoils, FcReadDiscrete, FcReadHolding, FcReadInput:
		if len(b) < 3 {
			return -1
		}
		return 5 + int(b[2])
	case FcWriteCoil, FcWriteRegister, FcWriteCoils, FcWriteRegisters:
		return 8
	case FcEncapsulated:
		if len(b) < 8 {
			return -1
		}
		i := 8
		for k := 0; k < int(b[7]); k++ {
			if len(b) < i+2 {
				return -1
			}
			i += 2 + int(b[i+1])
		}
		return i + 2
	}
	return -2
}

// RTURequestLength is RTUResponseLength for request frames (server side).
func RTURequestLength(b []byte) int {
	if len(b) < 2 {
		return -1
	}
	switch b[1] {
	case FcReadCoils, FcReadDiscrete, FcReadHolding, FcReadInput, FcWriteCoil, FcWriteRegister:
		return 8
	case FcWriteCoils, FcWriteRegisters:
		if len(b) < 7 {
			return -1
		}
		return 9 + int(b[6])
	case FcEncapsulated:
		return 7
	}
	return -2
}

// ReadTimeouter is a serial port: reads return (0, nil) when the timeout expires.
type ReadTimeouter interface {
	io.ReadWriteCloser
	SetReadTimeout(time.Duration) error
}

// RTUClient is a Modbus RTU master on a serial port. Requests are serialized.
type RTUClient struct {
	Port ReadTimeouter
	// CharTime is the time of one character on the wire; silence before a request is 3.5 of them.
	CharTime time.Duration
	// Delay is the minimum silence between transactions.
	Delay time.Duration
	Tap   Tap

	mu   sync.Mutex
	last time.Time
}

// CharTimeFor returns the duration of one character at baud with the given bits per character.
func CharTimeFor(baud, bitsPerChar int) time.Duration {
	return time.Duration(bitsPerChar) * time.Second / time.Duration(baud)
}

// Do sends one request and waits for the response PDU. It never retries.
func (c *RTUClient) Do(unit byte, req *Request, timeout time.Duration) (*Response, error) {
	if unit < 1 || unit > 247 {
		return nil, errors.New("unit id must be 1..247")
	}
	pdu, err := req.Encode()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	silence := max(c.Delay, c.CharTime*7/2)
	if wait := time.Until(c.last.Add(silence)); wait > 0 {
		time.Sleep(wait)
	}
	frame := WithCRC(append([]byte{unit}, pdu...))
	c.drain()
	c.Tap.emit("tx", frame, "")
	if _, err := c.Port.Write(frame); err != nil {
		c.last = time.Now()
		return nil, newErr(ErrPortDisconnected, "write: %v", err)
	}
	// The timeout starts when the request is on the wire.
	deadline := time.Now().Add(timeout + time.Duration(len(frame))*c.CharTime)
	buf := make([]byte, 0, 256)
	chunk := make([]byte, 256)
	for {
		remaining := time.Until(deadline)
		if remaining <= 0 {
			c.last = time.Now()
			c.Tap.emit("rx", buf, ErrTimeout)
			return nil, newErr(ErrTimeout, "unit %d did not answer within %s", unit, timeout)
		}
		_ = c.Port.SetReadTimeout(min(remaining, 50*time.Millisecond))
		n, err := c.Port.Read(chunk)
		if err != nil {
			c.last = time.Now()
			return nil, newErr(ErrPortDisconnected, "read: %v", err)
		}
		buf = append(buf, chunk[:n]...)
		need := RTUResponseLength(buf)
		if need == -2 {
			c.last = time.Now()
			c.Tap.emit("rx", buf, ErrInvalidResponse)
			return nil, newErr(ErrInvalidResponse, "unknown function code in response")
		}
		if need < 0 || len(buf) < need {
			continue
		}
		c.last = time.Now()
		f := buf[:need]
		if !CheckCRC(f) {
			c.Tap.emit("rx", f, ErrCRC)
			return nil, newErr(ErrCRC, "CRC mismatch")
		}
		if f[0] != unit {
			c.Tap.emit("rx", f, ErrInvalidResponse)
			return nil, newErr(ErrInvalidResponse, "response from unit %d, expected %d", f[0], unit)
		}
		res, err := DecodeResponse(req, f[1:need-2])
		code := Code("")
		var me *Error
		if errors.As(err, &me) {
			code = me.Code
		}
		c.Tap.emit("rx", f, code)
		return res, err
	}
}

// drain discards stale bytes (a late reply to a timed-out request).
func (c *RTUClient) drain() {
	_ = c.Port.SetReadTimeout(time.Millisecond)
	b := make([]byte, 256)
	for i := 0; i < 8; i++ {
		n, err := c.Port.Read(b)
		if n == 0 || err != nil {
			return
		}
		c.Tap.emit("rx", b[:n], ErrInvalidResponse)
	}
}

// Close closes the port.
func (c *RTUClient) Close() error { return c.Port.Close() }
