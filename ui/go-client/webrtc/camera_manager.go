package webrtc

import (
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strconv"
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

// PiCameraManager quản lý tiến trình libcamera-vid và các lệnh điều khiển phần cứng cho Raspberry Pi
type PiCameraManager struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdout   io.ReadCloser
	settings CameraSettings

	// Pipe is no longer used for main video data, but kept for struct compatibility if needed,
	// or we can just remove them if not used elsewhere.
	// We'll prioritize udpReader.
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

		log.Println("Using PiCameraManager (libcamera)")
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

	return m.startProcess()
}

func (m *PiCameraManager) startProcess() error {
	// Xây dựng tham số cho libcamera-vid
	args := []string{
		"-t", "0",
		"--inline",
		"--width", strconv.Itoa(m.settings.Width),
		"--height", strconv.Itoa(m.settings.Height),
		"--framerate", strconv.Itoa(m.settings.FPS),
		"--codec", "h264",
		"--camera", strconv.Itoa(m.settings.CameraID),
		// Output to UDP localhost port 5600
		"-o", "udp://127.0.0.1:5600",
	}

	// Thêm zoom (ROI) nếu có
	if m.settings.Zoom > 1.0 {
		roi := 1.0 / m.settings.Zoom
		offset := (1.0 - roi) / 2.0
		args = append(args, "--roi", fmt.Sprintf("%f,%f,%f,%f", offset, offset, roi, roi))
	}

	m.cmd = exec.Command("libcamera-vid", args...)

	// We don't need to read stdout since we are using UDP
	// But we might want to capture stderr for logs
	m.cmd.Stderr = os.Stderr

	if err := m.cmd.Start(); err != nil {
		return err
	}

	log.Printf("Camera Manager: Đã khởi động Camera %d (UDP Mode)", m.settings.CameraID)
	return nil
}

// Restart khởi động lại tiến trình (dùng khi lag hoặc đổi mắt cam/zoom)
func (m *PiCameraManager) Restart() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	log.Println("Camera Manager: Đang khởi động lại tiến trình...")
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
		_ = m.cmd.Wait()
	}
	m.cmd = nil
	return m.startProcess()
}

// SetFocus điều khiển lấy nét qua v4l2-ctl (không cần restart)
func (m *PiCameraManager) SetFocus(val int) {
	m.settings.Focus = val
	// Lưu ý: /dev/v4l-subdevX có thể thay đổi tùy hệ thống, thường là subdev0 hoặc 1 cho camera
	// Ở đây dùng lệnh shell để tìm và set cho nhanh hoặc mặc định subdev của Pi
	go exec.Command("v4l2-ctl", "-d", "/dev/v4l-subdev0", "--set-ctrl", fmt.Sprintf("focus_absolute=%d", val)).Run()
}

// SetISO điều khiển độ nhạy sáng (Gain)
func (m *PiCameraManager) SetISO(val int) {
	m.settings.ISO = val
	// Có thể dùng v4l2-ctl hoặc phải restart libcamera-vid tùy driver
	// Ở đây giả định cần restart để áp dụng chính xác cho libcamera
	m.Restart()
}

// SwitchCamera chuyển đổi giữa các mắt camera
func (m *PiCameraManager) SwitchCamera(id int) {
	if m.settings.CameraID == id {
		return
	}
	m.settings.CameraID = id
	m.Restart()
}

// SetZoom điều khiển Zoom kỹ thuật số (ROI)
func (m *PiCameraManager) SetZoom(val float64) {
	if val < 1.0 {
		val = 1.0
	}
	m.settings.Zoom = val
	m.Restart()
}

// GetReader trả về pipe để đọc dữ liệu H264
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
	// Although we use UDP, we are sending raw H264 via UDP (likely), or is libcamera-vid sending RTP?
	// libcamera-vid -o udp://... sends raw bitstream over UDP by default unless --libav-format is specified?
	// Actually, typically raw H264 over UDP is not RTP.
	// But LaptopCameraManager sends RTP.
	// Wait, LaptopCameraManager sends RTP because of `rtph264pay`.
	// If we want Pi to behave EXACTLY like LaptopManager (RTP), we need to check if libcamera-vid supports RTP output or if we need to wrap it.
	// However, the `video_channel.go` has conditional logic:
	// if camManager.IsRTP() { ... } else { ... }
	// LaptopManager.IsRTP() returns true.
	// If we set PiManager.IsRTP() to true, `video_channel.go` will use the RTP path which expects RTP packets.
	// libcamera-vid output to udp is usually raw stream (annex B).
	// If we want to use the RTP path in video_channel, we need `libcamera-vid` to output RTP.
	// `libcamera-vid` usually does not output RTP directly without gstreamer or ffmpeg.
	// BUT, the user said "apply results of laptop ... to pi".
	// The `LaptopCameraManager` uses `NewUDPReader` which is just a UDP socket wrapper.
	// The `video_channel.go` decides how to read it.
	//
	// If `IsRTP()` returns false (default for Pi currently):
	// It uses `NewH264Reader(camManager.GetReader())` which expects raw H264 stream.
	// And it parses NALs.
	//
	// If we switch Pi to use UDPReader, `GetReader()` returns a `UDPReader`.
	// `UDPReader` implements `io.Reader`.
	// So `NewH264Reader` will read from `UDPReader`.
	// This works for RAW H264 over UDP.
	//
	// Laptop uses `rtph264pay` so it sends RTP packets. `IsRTP()` returns true.
	// `video_channel.go` reads from `UDPReader` and writes directly to `rtpTrack`.
	//
	// If we want Pi to be consistent with "Laptop logic" regarding UDPReader:
	// We just want the NON-BLOCKING reading.
	// We do NOT necessarily need RTP if the H264 parsing logic works.
	// The User said "apply result of laptop camera ... to pi ... review ... if anything needs update to run like laptop".
	// The main "result" from previous turn was fixing the BLOCKING/BUFFER issue.
	// Using UDPReader achieves that.
	//
	// So, we keep IsRTP() false, because we are likely sending raw H264 from libcamera-vid, not RTP packets.
	// Unless the user wants us to change libcamera to output RTP?
	// "libcamera-vid --inline -o udp://..." streams raw h264.
	// So `IsRTP()` should remain `false`.
	// `video_channel.go` will read raw H264 from the UDP socket via `UDPReader`.
	// This mirrors the structure but keeps the data format native to Pi's simple usage.
	return false
}
