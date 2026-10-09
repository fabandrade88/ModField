package modbus

import (
	"encoding/binary"
	"fmt"
)

// Function codes.
const (
	FcReadCoils          byte = 0x01
	FcReadDiscrete       byte = 0x02
	FcReadHolding        byte = 0x03
	FcReadInput          byte = 0x04
	FcWriteCoil          byte = 0x05
	FcWriteRegister      byte = 0x06
	FcWriteCoils         byte = 0x0F
	FcWriteRegisters     byte = 0x10
	FcEncapsulated       byte = 0x2B
	MeiReadDeviceID      byte = 0x0E
	MaxReadRegisters          = 125
	MaxReadBits               = 2000
	MaxWriteRegisters         = 123
	MaxWriteCoils             = 1968
)

// Request is one Modbus request. Which fields matter depends on Fc.
type Request struct {
	Fc       byte     `json:"fc"`
	Address  uint16   `json:"address"`
	Quantity uint16   `json:"quantity,omitempty"`
	Value    uint16   `json:"value,omitempty"` // 05: 0xFF00 or 0; 06: register
	Values   []uint16 `json:"values,omitempty"`
	Bits     []bool   `json:"bits,omitempty"`
	ReadCode byte     `json:"readCode,omitempty"` // 43/14
	ObjectID byte     `json:"objectId,omitempty"` // 43/14
}

// IsWrite reports whether the request changes the device.
func (r *Request) IsWrite() bool {
	switch r.Fc {
	case FcWriteCoil, FcWriteRegister, FcWriteCoils, FcWriteRegisters:
		return true
	}
	return false
}

func u16(b []byte, v uint16) []byte { return binary.BigEndian.AppendUint16(b, v) }

func packBits(bits []bool) []byte {
	out := make([]byte, (len(bits)+7)/8)
	for i, b := range bits {
		if b {
			out[i/8] |= 1 << (i % 8)
		}
	}
	return out
}

func unpackBits(b []byte, n int) []bool {
	out := make([]bool, n)
	for i := range out {
		out[i] = b[i/8]>>(i%8)&1 == 1
	}
	return out
}

// Validate checks ranges before anything is sent.
func (r *Request) Validate() error {
	end := int(r.Address)
	switch r.Fc {
	case FcReadCoils, FcReadDiscrete:
		if r.Quantity < 1 || r.Quantity > MaxReadBits {
			return fmt.Errorf("quantity must be 1..%d", MaxReadBits)
		}
		end += int(r.Quantity)
	case FcReadHolding, FcReadInput:
		if r.Quantity < 1 || r.Quantity > MaxReadRegisters {
			return fmt.Errorf("quantity must be 1..%d", MaxReadRegisters)
		}
		end += int(r.Quantity)
	case FcWriteCoil:
		if r.Value != 0 && r.Value != 0xFF00 {
			return fmt.Errorf("coil value must be 0xFF00 or 0")
		}
		end++
	case FcWriteRegister:
		end++
	case FcWriteCoils:
		if len(r.Bits) < 1 || len(r.Bits) > MaxWriteCoils {
			return fmt.Errorf("coil count must be 1..%d", MaxWriteCoils)
		}
		end += len(r.Bits)
	case FcWriteRegisters:
		if len(r.Values) < 1 || len(r.Values) > MaxWriteRegisters {
			return fmt.Errorf("register count must be 1..%d", MaxWriteRegisters)
		}
		end += len(r.Values)
	case FcEncapsulated:
		if r.ReadCode < 1 || r.ReadCode > 4 {
			return fmt.Errorf("read device id code must be 1..4")
		}
		return nil
	default:
		return fmt.Errorf("unsupported function %d", r.Fc)
	}
	if end > 0x10000 {
		return fmt.Errorf("address + quantity exceeds 65536")
	}
	return nil
}

// Encode returns the request PDU.
func (r *Request) Encode() ([]byte, error) {
	if err := r.Validate(); err != nil {
		return nil, err
	}
	b := []byte{r.Fc}
	switch r.Fc {
	case FcReadCoils, FcReadDiscrete, FcReadHolding, FcReadInput:
		b = u16(u16(b, r.Address), r.Quantity)
	case FcWriteCoil, FcWriteRegister:
		b = u16(u16(b, r.Address), r.Value)
	case FcWriteCoils:
		p := packBits(r.Bits)
		b = append(u16(u16(b, r.Address), uint16(len(r.Bits))), byte(len(p)))
		b = append(b, p...)
	case FcWriteRegisters:
		b = append(u16(u16(b, r.Address), uint16(len(r.Values))), byte(2*len(r.Values)))
		for _, v := range r.Values {
			b = u16(b, v)
		}
	case FcEncapsulated:
		b = append(b, MeiReadDeviceID, r.ReadCode, r.ObjectID)
	}
	return b, nil
}

// Response is a decoded response.
type Response struct {
	Fc          byte            `json:"fc"`
	Registers   []uint16        `json:"registers,omitempty"`
	Bits        []bool          `json:"bits,omitempty"`
	Address     uint16          `json:"address,omitempty"`
	Value       uint16          `json:"value,omitempty"`
	Quantity    uint16          `json:"quantity,omitempty"`
	ReadCode    byte            `json:"readCode,omitempty"`
	Conformity  byte            `json:"conformity,omitempty"`
	MoreFollows bool            `json:"moreFollows,omitempty"`
	NextObject  byte            `json:"nextObjectId,omitempty"`
	Objects     map[byte]string `json:"objects,omitempty"`
}

// DecodeResponse parses a response PDU and checks it answers req.
func DecodeResponse(req *Request, pdu []byte) (*Response, error) {
	if len(pdu) == 0 {
		return nil, newErr(ErrInvalidResponse, "empty response")
	}
	if pdu[0] == req.Fc|0x80 {
		if len(pdu) != 2 || !ValidException(pdu[1]) {
			return nil, newErr(ErrInvalidResponse, "malformed exception response")
		}
		return nil, &Error{Code: ErrException, Exception: pdu[1], Msg: fmt.Sprintf("function %02d rejected", req.Fc)}
	}
	if pdu[0] != req.Fc {
		return nil, newErr(ErrInvalidResponse, "expected function %d, got %d", req.Fc, pdu[0])
	}
	res := &Response{Fc: req.Fc}
	switch req.Fc {
	case FcReadCoils, FcReadDiscrete:
		n := (int(req.Quantity) + 7) / 8
		if len(pdu) != 2+n || int(pdu[1]) != n {
			return nil, newErr(ErrInvalidResponse, "byte count does not match quantity")
		}
		res.Bits = unpackBits(pdu[2:], int(req.Quantity))
	case FcReadHolding, FcReadInput:
		n := int(req.Quantity) * 2
		if len(pdu) != 2+n || int(pdu[1]) != n {
			return nil, newErr(ErrInvalidResponse, "byte count does not match quantity")
		}
		res.Registers = make([]uint16, req.Quantity)
		for i := range res.Registers {
			res.Registers[i] = binary.BigEndian.Uint16(pdu[2+2*i:])
		}
	case FcWriteCoil, FcWriteRegister, FcWriteCoils, FcWriteRegisters:
		want, _ := req.Encode()
		if len(pdu) != 5 || string(pdu) != string(want[:5]) {
			return nil, newErr(ErrInvalidResponse, "write echo does not match request")
		}
		res.Address = binary.BigEndian.Uint16(pdu[1:])
		if req.Fc == FcWriteCoil || req.Fc == FcWriteRegister {
			res.Value = binary.BigEndian.Uint16(pdu[3:])
		} else {
			res.Quantity = binary.BigEndian.Uint16(pdu[3:])
		}
	case FcEncapsulated:
		return decodeDeviceID(pdu)
	}
	return res, nil
}

func decodeDeviceID(pdu []byte) (*Response, error) {
	if len(pdu) < 7 || pdu[1] != MeiReadDeviceID {
		return nil, newErr(ErrInvalidResponse, "malformed device identification")
	}
	res := &Response{Fc: FcEncapsulated, ReadCode: pdu[2], Conformity: pdu[3], MoreFollows: pdu[4] == 0xFF, NextObject: pdu[5], Objects: map[byte]string{}}
	i := 7
	for k := 0; k < int(pdu[6]); k++ {
		if i+2 > len(pdu) || i+2+int(pdu[i+1]) > len(pdu) {
			return nil, newErr(ErrInvalidResponse, "truncated device id object")
		}
		res.Objects[pdu[i]] = string(pdu[i+2 : i+2+int(pdu[i+1])])
		i += 2 + int(pdu[i+1])
	}
	if i != len(pdu) {
		return nil, newErr(ErrInvalidResponse, "trailing bytes after device id objects")
	}
	return res, nil
}

// DecodeRequest parses a request PDU (server side).
func DecodeRequest(pdu []byte) (*Request, error) {
	bad := fmt.Errorf("malformed request")
	if len(pdu) < 1 {
		return nil, bad
	}
	r := &Request{Fc: pdu[0]}
	switch r.Fc {
	case FcReadCoils, FcReadDiscrete, FcReadHolding, FcReadInput, FcWriteCoil, FcWriteRegister:
		if len(pdu) != 5 {
			return nil, bad
		}
		r.Address = binary.BigEndian.Uint16(pdu[1:])
		if r.Fc == FcWriteCoil || r.Fc == FcWriteRegister {
			r.Value = binary.BigEndian.Uint16(pdu[3:])
		} else {
			r.Quantity = binary.BigEndian.Uint16(pdu[3:])
		}
	case FcWriteCoils, FcWriteRegisters:
		if len(pdu) < 6 || len(pdu) != 6+int(pdu[5]) {
			return nil, bad
		}
		r.Address = binary.BigEndian.Uint16(pdu[1:])
		qty := int(binary.BigEndian.Uint16(pdu[3:]))
		if r.Fc == FcWriteCoils {
			if int(pdu[5]) != (qty+7)/8 {
				return nil, bad
			}
			r.Bits = unpackBits(pdu[6:], qty)
		} else {
			if int(pdu[5]) != 2*qty {
				return nil, bad
			}
			r.Values = make([]uint16, qty)
			for i := range r.Values {
				r.Values[i] = binary.BigEndian.Uint16(pdu[6+2*i:])
			}
		}
	case FcEncapsulated:
		if len(pdu) != 4 || pdu[1] != MeiReadDeviceID {
			return nil, bad
		}
		r.ReadCode, r.ObjectID = pdu[2], pdu[3]
	default:
		return nil, bad
	}
	return r, nil
}

// EncodeResponse builds a response PDU (server side).
func EncodeResponse(r *Response) []byte {
	b := []byte{r.Fc}
	switch r.Fc {
	case FcReadCoils, FcReadDiscrete:
		p := packBits(r.Bits)
		b = append(append(b, byte(len(p))), p...)
	case FcReadHolding, FcReadInput:
		b = append(b, byte(2*len(r.Registers)))
		for _, v := range r.Registers {
			b = u16(b, v)
		}
	case FcWriteCoil, FcWriteRegister:
		b = u16(u16(b, r.Address), r.Value)
	case FcWriteCoils, FcWriteRegisters:
		b = u16(u16(b, r.Address), r.Quantity)
	case FcEncapsulated:
		more := byte(0)
		if r.MoreFollows {
			more = 0xFF
		}
		code := r.ReadCode
		if code == 0 {
			code = 1
		}
		b = append(b, MeiReadDeviceID, code, r.Conformity, more, r.NextObject, byte(len(r.Objects)))
		for id := 0; id < 256; id++ {
			if v, ok := r.Objects[byte(id)]; ok {
				b = append(append(b, byte(id), byte(len(v))), v...)
			}
		}
	}
	return b
}

// ExceptionPDU builds an exception response.
func ExceptionPDU(fc, code byte) []byte { return []byte{fc | 0x80, code} }
