package modbus

import (
	"encoding/binary"
	"errors"
	"io"
	"net"
	"sync"
	"time"
)

// Handler answers request PDUs for a unit. ok=false means stay silent (unknown unit).
type Handler interface {
	Handle(unit byte, pdu []byte) (resp []byte, ok bool)
}

// RequestLog receives every request a server heard.
type RequestLog func(t time.Time, unit byte, pdu []byte, resp []byte)

// TCPServer is a Modbus TCP slave.
type TCPServer struct {
	Handler Handler
	Log     RequestLog

	ln    net.Listener
	mu    sync.Mutex
	conns map[net.Conn]struct{}
	wg    sync.WaitGroup
}

// Listen starts serving on addr (e.g. 127.0.0.1:5020).
func (s *TCPServer) Listen(addr string) error {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return err
	}
	s.ln = ln
	s.conns = map[net.Conn]struct{}{}
	s.wg.Add(1)
	go s.accept()
	return nil
}

// Addr is the listening address.
func (s *TCPServer) Addr() string { return s.ln.Addr().String() }

func (s *TCPServer) accept() {
	defer s.wg.Done()
	for {
		c, err := s.ln.Accept()
		if err != nil {
			return
		}
		s.mu.Lock()
		s.conns[c] = struct{}{}
		s.mu.Unlock()
		s.wg.Add(1)
		go s.serve(c)
	}
}

func (s *TCPServer) serve(c net.Conn) {
	defer s.wg.Done()
	defer func() {
		s.mu.Lock()
		delete(s.conns, c)
		s.mu.Unlock()
		c.Close()
	}()
	for {
		head := make([]byte, 7)
		if _, err := io.ReadFull(c, head); err != nil {
			return
		}
		length := int(binary.BigEndian.Uint16(head[4:]))
		if length < 2 || length > 254 {
			return
		}
		pdu := make([]byte, length-1)
		if _, err := io.ReadFull(c, pdu); err != nil {
			return
		}
		resp, ok := s.Handler.Handle(head[6], pdu)
		if s.Log != nil {
			s.Log(time.Now(), head[6], pdu, resp)
		}
		if !ok {
			continue
		}
		out := append(head[:4:4], 0, 0)
		binary.BigEndian.PutUint16(out[4:], uint16(len(resp)+1))
		out = append(append(out, head[6]), resp...)
		if _, err := c.Write(out); err != nil {
			return
		}
	}
}

// Close stops the server and drops its connections.
func (s *TCPServer) Close() error {
	if s.ln == nil {
		return nil
	}
	err := s.ln.Close()
	s.mu.Lock()
	for c := range s.conns {
		c.Close()
	}
	s.mu.Unlock()
	s.wg.Wait()
	return err
}

// RTUServer is a Modbus RTU slave on a serial line (or any byte stream).
type RTUServer struct {
	Port    io.ReadWriter
	Handler Handler
	Log     RequestLog
}

// Serve reads request frames until the port fails. Bad CRCs and unknown
// units get no answer, like a real slave.
func (s *RTUServer) Serve() error {
	buf := make([]byte, 0, 512)
	chunk := make([]byte, 256)
	for {
		n, err := s.Port.Read(chunk)
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
		buf = append(buf, chunk[:n]...)
		for {
			need := RTURequestLength(buf)
			if need == -2 {
				buf = buf[:0] // garbage: resync
				break
			}
			if need < 0 || len(buf) < need {
				break
			}
			frame := append([]byte(nil), buf[:need]...)
			buf = append(buf[:0], buf[need:]...)
			if !CheckCRC(frame) {
				continue
			}
			resp, ok := s.Handler.Handle(frame[0], frame[1:need-2])
			if s.Log != nil {
				s.Log(time.Now(), frame[0], frame[1:need-2], resp)
			}
			if ok {
				if _, err := s.Port.Write(WithCRC(append([]byte{frame[0]}, resp...))); err != nil {
					return err
				}
			}
		}
	}
}
