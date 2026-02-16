package webrtc

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"sync"
)

// LaptopCameraManager simulates camera using ffmpeg on Ubuntu/Laptop
type LaptopCameraManager struct {
	mu        sync.Mutex
	cmd       *exec.Cmd
	stdout    io.ReadCloser
	settings  CameraSettings
	udpReader *UDPReader

	// Reuse existing settings struct, or we can just ignore some fields
}

// Ensure LaptopCameraManager implements ICameraManager
var _ ICameraManager = (*LaptopCameraManager)(nil)

func NewLaptopCameraManager() *LaptopCameraManager {
	return &LaptopCameraManager{
		settings: CameraSettings{
			CameraID: 0,
			Width:    1280,
			Height:   720,
			FPS:      30,
			Zoom:     1.0,
		},
	}
}

func (m *LaptopCameraManager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd != nil {
		return nil
	}

	// 1. Call NewUDPReader(5600) and store it.
	var err error
	m.udpReader, err = NewUDPReader(5600)
	if err != nil {
		return fmt.Errorf("failed to open UDP port 5600: %v", err)
	}

	// Force kill any lingering gst-launch processes to avoid port conflicts/zombies
	_ = exec.Command("pkill", "-f", "gst-launch-1.0").Run()

	return m.startProcess()
}

func (m *LaptopCameraManager) startProcess() error {
	// ffmpeg -f v4l2 -framerate 30 -video_size 1280x720 -i /dev/video0 -c:v libx264 -preset ultrafast -tune zerolatency -f h264 -
	// Note: You might need to adjust /dev/video0 if you have multiple cameras
	devPath := fmt.Sprintf("/dev/video%d", m.settings.CameraID)
	// Check if device exists
	if _, err := os.Stat(devPath); os.IsNotExist(err) {
		log.Printf("LaptopCameraManager: Device %s not found. Falling back to video0 or failing.", devPath)
		devPath = "/dev/video0"
	}

	// Build GStreamer pipeline
	// v4l2src -> jpegdec (for high FPS) -> x264enc -> udpsink
	args := []string{
		"-q",
		"v4l2src", "device=" + devPath,
		"!", fmt.Sprintf("image/jpeg,width=%d,height=%d,framerate=30/1", m.settings.Width, m.settings.Height),
		"!", "jpegdec",
		"!", "videoconvert",
		// Essential params:
		// bitrate=4000: High quality (4Mbps)
		// key-int-max=30: Keyframe every 1s (at 30fps)
		"!", "x264enc", "bitrate=4000", "speed-preset=ultrafast", "tune=zerolatency", "key-int-max=30", "bframes=0",
		// RTP Packetization:
		// rtph264pay takes H.264 stream and packetizes it into RTP packets.
		// config-interval=1: Send SPS/PPS with every keyframe (essential for WebRTC).
		// pt=96: Dynamic Payload Type (standard for H.264).
		"!", "rtph264pay", "config-interval=1", "pt=96", "mtu=1200",
		// Output RTP packets to UDP
		"!", "udpsink", "host=127.0.0.1", "port=5600",
	}

	log.Printf("Starting GStreamer: gst-launch-1.0 %v", args)
	m.cmd = exec.Command("gst-launch-1.0", args...)

	// Enable error logging
	m.cmd.Stderr = os.Stderr

	if err := m.cmd.Start(); err != nil {
		return err
	}

	// Removed: go func() {
	// Removed: 	_, err := io.Copy(m.pipeWriter, m.stdout)
	// Removed: 	if err != nil {
	// Removed: 		log.Printf("LaptopCameraManager: Pipe copy error: %v", err)
	// Removed: 	}
	// Removed: 	log.Println("LaptopCameraManager: Process stopped")
	// Removed: }()

	return nil
}

func (m *LaptopCameraManager) Restart() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	log.Println("LaptopCameraManager: Restarting...")

	if m.cmd != nil && m.cmd.Process != nil {
		// Soft kill first?
		_ = m.cmd.Process.Kill()
		_ = m.cmd.Wait()
	}
	m.cmd = nil
	return m.startProcess()
}

func (m *LaptopCameraManager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.udpReader != nil {
		m.udpReader.Close()
		m.udpReader = nil
	}

	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
	}
	m.cmd = nil
}

func (m *LaptopCameraManager) GetReader() io.Reader {
	return m.udpReader
}

func (m *LaptopCameraManager) SetZoom(val float64) {
	log.Printf("LaptopCameraManager: SetZoom %f (Not implemented in ffmpeg v4l2 wrapper yet)", val)
	m.settings.Zoom = val
	// To implement zoom, we'd need to use ffmpeg filters like -vf "scale=..." or crop
}

func (m *LaptopCameraManager) SetFocus(val int) {
	log.Printf("LaptopCameraManager: SetFocus %d (Not implemented)", val)
	m.settings.Focus = val
}

func (m *LaptopCameraManager) SetISO(val int) {
	log.Printf("LaptopCameraManager: SetISO %d (Not implemented)", val)
	m.settings.ISO = val
}

func (m *LaptopCameraManager) SwitchCamera(id int) {
	log.Printf("LaptopCameraManager: SwitchCamera to %d", id)
	if m.settings.CameraID == id {
		return
	}
	m.settings.CameraID = id
	m.Restart()
}

func (m *LaptopCameraManager) IsRTP() bool {
	return true
}
