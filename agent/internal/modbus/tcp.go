package modbus

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

// TCPClient is a Modbus TCP master (MBAP framing). Requests are serialized.
type TCPClient struct {
	Conn net.Conn
	Tap  Tap

	mu  sync.Mutex
	tid uint16
}

// DialTCP connects to host:port.
func DialTCP(addr string, timeout time.Duration, tap Tap) (*TCPClient, error) {
	c, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		var ne net.Error
		if errors.As(err, &ne) && ne.Timeout() {
			return nil, newErr(ErrTimeout, "connect %s: %v", addr, err)
		}
		return nil, newErr(ErrConnRefused, "connect %s: %v", addr, err)
	}
	return &TCPClient{Conn: c, Tap: tap}, nil
}

// Do sends one request and waits for the response. It never retries.
func (c *TCPClient) Do(unit byte, req *Request, timeout time.Duration) (*Response, error) {
	pdu, err := req.Encode()
	if err != nil {
		return nil, err
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.tid++
	frame := binary.BigEndian.AppendUint16(nil, c.tid)
	frame = binary.BigEndian.AppendUint16(frame, 0)
	frame = binary.BigEndian.AppendUint16(frame, uint16(len(pdu)+1))
	frame = append(append(frame, unit), pdu...)

	_ = c.Conn.SetDeadline(time.Now().Add(timeout))
	c.Tap.emit("tx", frame, "")
	if _, err := c.Conn.Write(frame); err != nil {
		return nil, newErr(ErrPortDisconnected, "write: %v", err)
	}
	for {
		head := make([]byte, 7)
		if n, err := io.ReadFull(c.Conn, head); err != nil {
			var ne net.Error
			if errors.As(err, &ne) && ne.Timeout() {
				c.Tap.emit("rx", head[:n], ErrTimeout)
				return nil, newErr(ErrTimeout, "unit %d did not answer within %s", unit, timeout)
			}
			return nil, newErr(ErrPortDisconnected, "read: %v", err)
		}
		length := int(binary.BigEndian.Uint16(head[4:]))
		if length < 2 || length > 254 {
			c.Tap.emit("rx", head, ErrInvalidResponse)
			return nil, newErr(ErrInvalidResponse, "bad MBAP length %d", length)
		}
		body := make([]byte, length-1)
		if _, err := io.ReadFull(c.Conn, body); err != nil {
			c.Tap.emit("rx", head, ErrTimeout)
			return nil, newErr(ErrTimeout, "truncated response")
		}
		full := append(head, body...)
		if tid := binary.BigEndian.Uint16(head); tid != c.tid {
			// A late answer to an earlier, timed-out request: skip it.
			c.Tap.emit("rx", full, ErrInvalidResponse)
			continue
		}
		if head[6] != unit {
			c.Tap.emit("rx", full, ErrInvalidResponse)
			return nil, newErr(ErrInvalidResponse, "response from unit %d, expected %d", head[6], unit)
		}
		res, err := DecodeResponse(req, body)
		code := Code("")
		var me *Error
		if errors.As(err, &me) {
			code = me.Code
		}
		c.Tap.emit("rx", full, code)
		return res, err
	}
}

// Close closes the connection.
func (c *TCPClient) Close() error { return c.Conn.Close() }
