package webrtc

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// CameraSettings lưu trữ trạng thái hiện tại của camera
type CameraSettings struct {
	CameraID int     `json:"camera_id"`
	Width    int     `json:"width"`
	Height   int     `json:"height"`
	FPS      int     `json:"fps"`
	Focus    int     `json:"focus"` // 0-1000
	ISO      int     `json:"iso"`   // Gain
	Zoom     float64 `json:"zoom"`  // 1.0 - 10.0
}

// PiCameraManager quản lý tiến trình GStreamer (thay thế libcamera-vid)
type PiCameraManager struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdout   io.ReadCloser
	settings CameraSettings

	// udpReader reads the RTP stream from the local UDP socket
	udpReader *UDPReader
}

// Check if PiCameraManager implements ICameraManager
var _ ICameraManager = (*PiCameraManager)(nil)

var (
	instance ICameraManager
	once     sync.Once
)

// GetCameraManager trả về singleton instance của ICameraManager
// Tự động phát hiện môi trường để chọn PiCameraManager hoặc LaptopCameraManager
func GetCameraManager() ICameraManager {
	once.Do(func() {
		osName := getOSName()
		log.Printf("Detected OS: %s", osName)

		if strings.Contains(strings.ToLower(osName), "ubuntu") ||
			strings.Contains(strings.ToLower(osName), "arch") ||
			strings.Contains(strings.ToLower(osName), "fedora") {
			log.Println("Using LaptopCameraManager (ffmpeg)")
			instance = NewLaptopCameraManager()
			return
		}

		log.Println("Using PiCameraManager (GStreamer)")
		instance = &PiCameraManager{
			settings: CameraSettings{
				CameraID: 0,
				Width:    1280,
				Height:   720,
				FPS:      30,
				Focus:    500,
				ISO:      100,
				Zoom:     1.0,
			},
		}
	})
	return instance
}

func getOSName() string {
	data, err := os.ReadFile("/etc/os-release")
	if err != nil {
		return "unknown"
	}
	return string(data)
}

// Start bắt đầu tiến trình camera
func (m *PiCameraManager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd != nil {
		return nil // Đã chạy rồi
	}

	// Init UDP Reader
	var err error
	m.udpReader, err = NewUDPReader(5600)
	if err != nil {
		return fmt.Errorf("failed to open UDP port 5600: %v", err)
	}

	// Kill any existing gstreamer processes (optional but safer)
	_ = exec.Command("pkill", "-f", "gst-launch-1.0").Run()

	return m.startProcess()
}

func (m *PiCameraManager) startProcess() error {
	cameraName := m.getCameraName(m.settings.CameraID)
	log.Printf("PiCameraManager: Selected Camera '%s' (Index %d)", cameraName, m.settings.CameraID)

	// Xây dựng tham số cho gst-launch-1.0
	// libcamerasrc -> videoconvert -> x264enc -> rtph264pay -> udpsink
	args := []string{
		"-q",
		"libcamerasrc",
	}

	if cameraName != "" {
		args = append(args, "camera-name="+cameraName)
	}

	args = append(args,
		"!", fmt.Sprintf("video/x-raw,format=NV12,width=%d,height=%d,framerate=%d/1", m.settings.Width, m.settings.Height, m.settings.FPS),
		"!", "videoconvert",
		// x264enc configuration for low latency
		"!", "x264enc", "bitrate=2000", "speed-preset=ultrafast", "tune=zerolatency", "key-int-max=30", "bframes=0",
		// RTP Packetization
		"!", "rtph264pay", "config-interval=1", "pt=96", "mtu=1200",
		// Output to localhost UDP
		"!", "udpsink", "host=127.0.0.1", "port=5600",
	)

	m.cmd = exec.Command("gst-launch-1.0", args...)
	m.cmd.Stderr = os.Stderr

	if err := m.cmd.Start(); err != nil {
		return convertGstError(err)
	}

	log.Printf("Camera Manager: Started GStreamer pipeline for Camera %d (RTP Mode)", m.settings.CameraID)
	return nil
}

func convertGstError(err error) error {
	if strings.Contains(err.Error(), "file not found") {
		return fmt.Errorf("gstreamer not found. Please install: sudo apt install gstreamer1.0-tools gstreamer1.0-plugins-bad gstreamer1.0-libcamera")
	}
	return err
}

// getCameraName tìm tên camera dựa trên index bằng cách gọi libcamera-hello --list-cameras
func (m *PiCameraManager) getCameraName(index int) string {
	// Output format example:
	// 0 : imx219 [1280x720] (/base/axi/pcie@120000/rp1/i2c@88000/imx219@10)

	cmd := exec.Command("libcamera-hello", "--list-cameras")
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Failed to list cameras: %v", err)
		return ""
	}

	lines := strings.Split(string(out), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, fmt.Sprintf("%d :", index)) {
			// Extract the value inside the last set of parentheses
			start := strings.LastIndex(line, "(")
			end := strings.LastIndex(line, ")")
			if start != -1 && end != -1 && end > start {
				return line[start+1 : end]
			}
		}
	}
	return ""
}

// Restart khởi động lại tiến trình
func (m *PiCameraManager) Restart() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	log.Println("Camera Manager: Restarting...")
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
		_ = m.cmd.Wait()
	}
	m.cmd = nil
	return m.startProcess()
}

// SetFocus
func (m *PiCameraManager) SetFocus(val int) {
	m.settings.Focus = val
	// GStreamer libcamerasrc might support 'controls' property but it's complicated to set periodically.
	// We can still try v4l2-ctl if the device node is exposed, but often libcamera locks it.
	log.Printf("SetFocus %d not fully supported in GStreamer mode yet (requires GstElement control)", val)
}

// SetISO
func (m *PiCameraManager) SetISO(val int) {
	m.settings.ISO = val
	m.Restart()
}

// SwitchCamera
func (m *PiCameraManager) SwitchCamera(id int) {
	if m.settings.CameraID == id {
		return
	}
	m.settings.CameraID = id
	m.Restart()
}

// SetZoom
func (m *PiCameraManager) SetZoom(val float64) {
	if val < 1.0 {
		val = 1.0
	}
	m.settings.Zoom = val
	log.Printf("SetZoom %f not supported in GStreamer mode yet", val)
}

// GetReader trả về pipe để đọc dữ liệu RTP
func (m *PiCameraManager) GetReader() io.Reader {
	return m.udpReader
}

// Stop dừng camera hoàn toàn
func (m *PiCameraManager) Stop() {
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

func (m *PiCameraManager) IsRTP() bool {
	// GStreamer output with rtph264pay IS RTP.
	return true
}
