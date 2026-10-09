package main

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/png"
	"runtime"
)

// trayIcon draws the logo (a square wave on dark) as PNG, wrapped in ICO on Windows.
func trayIcon() []byte {
	const n = 32
	img := image.NewRGBA(image.Rect(0, 0, n, n))
	bg := color.RGBA{0x1a, 0x1b, 0x26, 0xff}
	fg := color.RGBA{0x7a, 0xa2, 0xf7, 0xff}
	for y := 0; y < n; y++ {
		for x := 0; x < n; x++ {
			img.Set(x, y, bg)
		}
	}
	// Square wave: low, high, low, high.
	level := func(x int) int {
		if (x/7)%2 == 1 {
			return 9
		}
		return 22
	}
	for x := 3; x < n-3; x++ {
		y := level(x)
		for t := 0; t < 2; t++ {
			img.Set(x, y+t, fg)
		}
		if x > 3 && level(x-1) != y {
			lo, hi := min(y, level(x-1)), max(y, level(x-1))
			for yy := lo; yy <= hi+1; yy++ {
				img.Set(x, yy, fg)
				img.Set(x+1, yy, fg)
			}
		}
	}
	var buf bytes.Buffer
	_ = png.Encode(&buf, img)
	if runtime.GOOS != "windows" {
		return buf.Bytes()
	}
	// ICO with one embedded PNG image (supported since Windows Vista).
	var ico bytes.Buffer
	_ = binary.Write(&ico, binary.LittleEndian, []uint16{0, 1, 1})
	ico.Write([]byte{n, n, 0, 0})
	_ = binary.Write(&ico, binary.LittleEndian, []uint16{1, 32})
	_ = binary.Write(&ico, binary.LittleEndian, []uint32{uint32(buf.Len()), 22})
	ico.Write(buf.Bytes())
	return ico.Bytes()
}
