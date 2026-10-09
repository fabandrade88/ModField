package modbus

import "time"

// Frame is one frame seen on the wire, for the traffic monitor.
type Frame struct {
	T     time.Time
	Dir   string // "tx" or "rx"
	Bytes []byte
	Error Code // set on failed RX frames, and on timeouts (with whatever arrived)
}

// Tap receives every frame. It must not block.
type Tap func(Frame)

func (t Tap) emit(dir string, b []byte, code Code) {
	if t != nil {
		t(Frame{T: time.Now(), Dir: dir, Bytes: append([]byte(nil), b...), Error: code})
	}
}
