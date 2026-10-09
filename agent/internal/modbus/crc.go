// Package modbus is the agent's Modbus RTU/TCP client and server. It mirrors
// packages/protocol (TypeScript): RTU responses are delimited by their
// expected length and validated by CRC, never by inter-character silence, and
// every frame is reported to a Tap so the browser's traffic monitor can show
// the raw bytes.
package modbus

var crcTable = func() [256]uint16 {
	var t [256]uint16
	for i := range t {
		c := uint16(i)
		for k := 0; k < 8; k++ {
			if c&1 != 0 {
				c = c>>1 ^ 0xA001
			} else {
				c >>= 1
			}
		}
		t[i] = c
	}
	return t
}()

// CRC16 is CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF).
func CRC16(b []byte) uint16 {
	crc := uint16(0xFFFF)
	for _, x := range b {
		crc = crc>>8 ^ crcTable[(crc^uint16(x))&0xFF]
	}
	return crc
}

// WithCRC appends the CRC, low byte first as on the wire.
func WithCRC(body []byte) []byte {
	crc := CRC16(body)
	out := make([]byte, len(body), len(body)+2)
	copy(out, body)
	return append(out, byte(crc), byte(crc>>8))
}

// CheckCRC reports whether the last two bytes are the frame's CRC.
func CheckCRC(frame []byte) bool {
	if len(frame) < 4 {
		return false
	}
	n := len(frame) - 2
	return CRC16(frame[:n]) == uint16(frame[n])|uint16(frame[n+1])<<8
}
