package sim

import (
	"encoding/binary"
	"math"
)

// registerCount mirrors packages/protocol registerCount.
func registerCount(typ string, textLen int) int {
	switch typ {
	case "INT32", "UINT32", "FLOAT32":
		return 2
	case "FLOAT64":
		return 4
	case "STRING":
		return (textLen + 1) / 2
	}
	return 1
}

// encode mirrors packages/protocol encodeValue: big-endian bytes ABCD...,
// then word swap (CDAB, DCBA) and byte swap (BADC, DCBA).
func encode(v float64, typ, order string) []uint16 {
	var b []byte
	clamp := func(lo, hi float64) float64 { return math.Max(lo, math.Min(hi, math.Round(v))) }
	switch typ {
	case "INT16":
		b = binary.BigEndian.AppendUint16(nil, uint16(int16(clamp(-32768, 32767))))
	case "INT32":
		b = binary.BigEndian.AppendUint32(nil, uint32(int32(clamp(-2147483648, 2147483647))))
	case "UINT32":
		b = binary.BigEndian.AppendUint32(nil, uint32(clamp(0, 4294967295)))
	case "FLOAT32":
		b = binary.BigEndian.AppendUint32(nil, math.Float32bits(float32(v)))
	case "FLOAT64":
		b = binary.BigEndian.AppendUint64(nil, math.Float64bits(v))
	default: // UINT16
		b = binary.BigEndian.AppendUint16(nil, uint16(clamp(0, 65535)))
	}
	return toRegisters(b, order)
}

func encodeText(s, order string) []uint16 {
	b := []byte(s)
	if len(b)%2 == 1 {
		b = append(b, 0)
	}
	return toRegisters(b, order)
}

func toRegisters(b []byte, order string) []uint16 {
	n := len(b) / 2
	regs := make([]uint16, n)
	wordSwap := order == "CDAB" || order == "DCBA"
	byteSwap := order == "BADC" || order == "DCBA"
	for i := 0; i < n; i++ {
		hi, lo := b[2*i], b[2*i+1]
		if byteSwap {
			hi, lo = lo, hi
		}
		j := i
		if wordSwap {
			j = n - 1 - i
		}
		regs[j] = uint16(hi)<<8 | uint16(lo)
	}
	return regs
}
