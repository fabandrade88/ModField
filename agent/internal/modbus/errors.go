package modbus

import "fmt"

// Code is one of the fixed error codes shared with the browser.
type Code string

const (
	ErrTimeout          Code = "TIMEOUT"
	ErrCRC              Code = "CRC_ERROR"
	ErrInvalidResponse  Code = "INVALID_RESPONSE"
	ErrException        Code = "MODBUS_EXCEPTION"
	ErrPortBusy         Code = "PORT_BUSY"
	ErrPortDisconnected Code = "PORT_DISCONNECTED"
	ErrPermission       Code = "PERMISSION_DENIED"
	ErrConnRefused      Code = "CONN_REFUSED"
	ErrNotPaired        Code = "NOT_PAIRED"
	ErrOriginRejected   Code = "ORIGIN_REJECTED"
	ErrConfirmRequired  Code = "CONFIRM_REQUIRED"
	ErrProtocolMismatch Code = "PROTOCOL_MISMATCH"
)

// Exception codes defined by the Modbus spec. 07 and 09 do not exist.
const (
	ExIllegalFunction    byte = 0x01
	ExIllegalAddress     byte = 0x02
	ExIllegalValue       byte = 0x03
	ExDeviceFailure      byte = 0x04
	ExAcknowledge        byte = 0x05
	ExDeviceBusy         byte = 0x06
	ExMemoryParity       byte = 0x08
	ExGatewayPath        byte = 0x0A
	ExGatewayTargetFaild byte = 0x0B
)

// ValidException reports whether b is a defined exception code.
func ValidException(b byte) bool {
	switch b {
	case 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x08, 0x0A, 0x0B:
		return true
	}
	return false
}

// Error is a Modbus failure with its fixed code.
type Error struct {
	Code      Code
	Exception byte // set when Code is MODBUS_EXCEPTION
	Msg       string
}

func (e *Error) Error() string {
	if e.Code == ErrException {
		return fmt.Sprintf("%s %02X: %s", e.Code, e.Exception, e.Msg)
	}
	return fmt.Sprintf("%s: %s", e.Code, e.Msg)
}

func newErr(code Code, format string, a ...any) *Error {
	return &Error{Code: code, Msg: fmt.Sprintf(format, a...)}
}
