package modbus

import (
	"encoding/hex"
	"strings"
	"testing"
)

func h(s string) []byte {
	b, err := hex.DecodeString(strings.ReplaceAll(s, " ", ""))
	if err != nil {
		panic(err)
	}
	return b
}

func TestCRCVectors(t *testing.T) {
	if got := CRC16([]byte("123456789")); got != 0x4B37 {
		t.Fatalf("check value: got %04X", got)
	}
	for _, f := range []string{
		"01 03 0000 000A C5CD",
		"11 03 006B 0003 7687",
		"11 06 0001 0003 9A9B",
		"11 01 0013 0025 0E84",
		"11 03 06 AE41 5652 4340 49AD",
		"0A 81 02 B053",
	} {
		b := h(f)
		if !CheckCRC(b) {
			t.Errorf("%s: CRC should be valid", f)
		}
		if got := WithCRC(b[:len(b)-2]); string(got) != string(b) {
			t.Errorf("%s: WithCRC = % X", f, got)
		}
	}
}

func TestRequestRoundTrip(t *testing.T) {
	cases := []struct {
		req Request
		pdu string
	}{
		{Request{Fc: FcReadHolding, Address: 0x6B, Quantity: 3}, "03 006B 0003"},
		{Request{Fc: FcWriteCoil, Address: 0xAC, Value: 0xFF00}, "05 00AC FF00"},
		{Request{Fc: FcWriteRegisters, Address: 1, Values: []uint16{0x000A, 0x0102}}, "10 0001 0002 04 000A 0102"},
		{Request{Fc: FcWriteCoils, Address: 0x13, Bits: []bool{true, false, true, true, false, false, true, true, true, false}}, "0F 0013 000A 02 CD 01"},
		{Request{Fc: FcEncapsulated, ReadCode: 1}, "2B 0E 01 00"},
	}
	for _, c := range cases {
		got, err := c.req.Encode()
		if err != nil || string(got) != string(h(c.pdu)) {
			t.Errorf("%+v: got % X, %v", c.req, got, err)
		}
		back, err := DecodeRequest(got)
		if err != nil {
			t.Fatal(err)
		}
		again, _ := back.Encode()
		if string(again) != string(got) {
			t.Errorf("decode/encode mismatch for %s", c.pdu)
		}
	}
}

func TestValidate(t *testing.T) {
	for _, r := range []Request{
		{Fc: FcReadHolding, Quantity: 126},
		{Fc: FcReadCoils, Quantity: 2001},
		{Fc: FcReadHolding, Address: 65535, Quantity: 2},
		{Fc: FcWriteCoil, Value: 1},
		{Fc: FcWriteRegisters},
	} {
		if _, err := r.Encode(); err == nil {
			t.Errorf("%+v should be rejected", r)
		}
	}
}

func TestDecodeExceptions(t *testing.T) {
	req := &Request{Fc: FcReadHolding, Quantity: 1}
	_, err := DecodeResponse(req, h("83 02"))
	if e, ok := err.(*Error); !ok || e.Code != ErrException || e.Exception != 2 {
		t.Fatalf("got %v", err)
	}
	if _, err := DecodeResponse(req, h("83 09")); err == nil || err.(*Error).Code != ErrInvalidResponse {
		t.Fatalf("09 is not a Modbus exception: %v", err)
	}
}

func TestResponseLength(t *testing.T) {
	for in, want := range map[string]int{
		"11": -1, "11 03": -1, "11 03 06": 11, "11 06": 8, "0A 81": 5, "11 63": -2,
		"11 2B 0E 01 01 00 00 01 00 03": 15, "11 2B 0E 01 01 00 00 00": 10,
	} {
		if got := RTUResponseLength(h(in)); got != want {
			t.Errorf("%s: got %d want %d", in, got, want)
		}
	}
}
