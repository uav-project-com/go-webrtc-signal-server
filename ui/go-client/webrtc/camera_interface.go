package webrtc

import "io"

// ICameraManager defines the interface for camera operations
type ICameraManager interface {
	Start() error
	Restart() error
	Stop()
	GetReader() io.Reader
	SetZoom(val float64)
	SetFocus(val int)
	SetISO(val int)
	SwitchCamera(id int)
	IsRTP() bool
}
