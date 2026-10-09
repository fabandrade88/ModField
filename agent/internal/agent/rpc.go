package agent

import (
	"encoding/json"
	"errors"

	"modfield.dev/agent/internal/modbus"
)

// ProtocolMajor and ProtocolMinor match PROTOCOL_VERSION in packages/protocol.
const (
	ProtocolMajor = 1
	ProtocolMinor = 0
)

type rpcRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      *int64          `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type rpcError struct {
	Code    int       `json:"code"`
	Message string    `json:"message"`
	Data    errorData `json:"data"`
}

type errorData struct {
	Error     modbus.Code `json:"error,omitempty"`
	Exception byte        `json:"exception,omitempty"`
	// Group owning the serial device, for the "add yourself to dialout/uucp" hint.
	Group string `json:"group,omitempty"`
}

type rpcResponse struct {
	JSONRPC string    `json:"jsonrpc"`
	ID      int64     `json:"id"`
	Result  any       `json:"result,omitempty"`
	Error   *rpcError `json:"error,omitempty"`
}

type rpcNotification struct {
	JSONRPC string `json:"jsonrpc"`
	Method  string `json:"method"`
	Params  any    `json:"params"`
}

// JSON-RPC codes. Application errors use -32000 with the fixed code in data.error.
const (
	codeParse     = -32700
	codeMethod    = -32601
	codeParams    = -32602
	codeAppError  = -32000
	codeNotPaired = -32001
)

func toRPCError(err error) *rpcError {
	var me *modbus.Error
	if errors.As(err, &me) {
		return &rpcError{Code: codeAppError, Message: me.Error(), Data: errorData{Error: me.Code, Exception: me.Exception}}
	}
	var pe *permissionError
	if errors.As(err, &pe) {
		return &rpcError{Code: codeAppError, Message: pe.Error(), Data: errorData{Error: modbus.ErrPermission, Group: pe.group}}
	}
	var ie *paramsError
	if errors.As(err, &ie) {
		return &rpcError{Code: codeParams, Message: ie.Error()}
	}
	return &rpcError{Code: codeAppError, Message: err.Error()}
}

type paramsError struct{ msg string }

func (e *paramsError) Error() string { return e.msg }

func badParams(msg string) error { return &paramsError{msg} }

type permissionError struct {
	msg   string
	group string
}

func (e *permissionError) Error() string { return e.msg }
