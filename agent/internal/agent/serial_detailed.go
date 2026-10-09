//go:build !darwin || cgo

package agent

import (
	"go.bug.st/serial"
	"go.bug.st/serial/enumerator"
)

// listSerial lists ports with USB details (VID/PID, product): the names
// (COM3, /dev/ttyUSB0) the browser alone cannot show.
func listSerial() ([]SerialPortInfo, error) {
	ports, err := enumerator.GetDetailedPortsList()
	if err != nil {
		return namesOnly()
	}
	out := make([]SerialPortInfo, 0, len(ports))
	for _, p := range ports {
		out = append(out, SerialPortInfo{Name: p.Name, IsUSB: p.IsUSB, VID: p.VID, PID: p.PID, Product: p.Product, SerialNumber: p.SerialNumber})
	}
	return out, nil
}

func namesOnly() ([]SerialPortInfo, error) {
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
