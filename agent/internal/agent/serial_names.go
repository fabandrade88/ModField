//go:build darwin && !cgo

package agent

import "go.bug.st/serial"

// listSerial without CGO on macOS: names only (the USB details need IOKit).
func listSerial() ([]SerialPortInfo, error) {
	names, err := serial.GetPortsList()
	if err != nil {
		return nil, err
	}
	out := make([]SerialPortInfo, len(names))
	for i, n := range names {
		out[i] = SerialPortInfo{Name: n}
	}
	return out, nil
}
