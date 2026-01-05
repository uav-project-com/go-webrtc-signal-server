package webrtc

import (
	"fmt"
	"io"
	"log"
	"os/exec"
	"strconv"
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

// CameraManager quản lý tiến trình libcamera-vid và các lệnh điều khiển phần cứng
type CameraManager struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdout   io.ReadCloser
	settings CameraSettings

	// Pipe để VideoChannelClient đọc dữ liệu
	pipeReader *io.PipeReader
	pipeWriter *io.PipeWriter
}

var (
	instance *CameraManager
	once     sync.Once
)

// GetCameraManager trả về singleton instance của CameraManager
func GetCameraManager() *CameraManager {
	once.Do(func() {
		pr, pw := io.Pipe()
		instance = &CameraManager{
			pipeReader: pr,
			pipeWriter: pw,
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

// Start bắt đầu tiến trình camera
func (m *CameraManager) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd != nil {
		return nil // Đã chạy rồi
	}

	return m.startProcess()
}

func (m *CameraManager) startProcess() error {
	// Xây dựng tham số cho libcamera-vid
	args := []string{
		"-t", "0",
		"--inline",
		"--width", strconv.Itoa(m.settings.Width),
		"--height", strconv.Itoa(m.settings.Height),
		"--framerate", strconv.Itoa(m.settings.FPS),
		"--codec", "h264",
		"--camera", strconv.Itoa(m.settings.CameraID),
		"-o", "-", // Xuất ra stdout
	}

	// Thêm zoom (ROI) nếu có
	if m.settings.Zoom > 1.0 {
		roi := 1.0 / m.settings.Zoom
		offset := (1.0 - roi) / 2.0
		args = append(args, "--roi", fmt.Sprintf("%f,%f,%f,%f", offset, offset, roi, roi))
	}

	m.cmd = exec.Command("libcamera-vid", args...)

	stdout, err := m.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	m.stdout = stdout

	if err := m.cmd.Start(); err != nil {
		return err
	}

	// Luồng copy dữ liệu từ camera vào Pipe
	go func() {
		_, err := io.Copy(m.pipeWriter, m.stdout)
		if err != nil {
			log.Printf("Camera Manager: Lỗi copy dữ liệu: %v", err)
		}
		log.Println("Camera Manager: Tiến trình camera đã dừng.")
	}()

	log.Printf("Camera Manager: Đã khởi động Camera %d", m.settings.CameraID)
	return nil
}

// Restart khởi động lại tiến trình (dùng khi lag hoặc đổi mắt cam/zoom)
func (m *CameraManager) Restart() error {
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
func (m *CameraManager) SetFocus(val int) {
	m.settings.Focus = val
	// Lưu ý: /dev/v4l-subdevX có thể thay đổi tùy hệ thống, thường là subdev0 hoặc 1 cho camera
	// Ở đây dùng lệnh shell để tìm và set cho nhanh hoặc mặc định subdev của Pi
	go exec.Command("v4l2-ctl", "-d", "/dev/v4l-subdev0", "--set-ctrl", fmt.Sprintf("focus_absolute=%d", val)).Run()
}

// SetISO điều khiển độ nhạy sáng (Gain)
func (m *CameraManager) SetISO(val int) {
	m.settings.ISO = val
	// Có thể dùng v4l2-ctl hoặc phải restart libcamera-vid tùy driver
	// Ở đây giả định cần restart để áp dụng chính xác cho libcamera
	m.Restart()
}

// SwitchCamera chuyển đổi giữa các mắt camera
func (m *CameraManager) SwitchCamera(id int) {
	if m.settings.CameraID == id {
		return
	}
	m.settings.CameraID = id
	m.Restart()
}

// SetZoom điều khiển Zoom kỹ thuật số (ROI)
func (m *CameraManager) SetZoom(val float64) {
	if val < 1.0 { val = 1.0 }
	m.settings.Zoom = val
	m.Restart()
}

// GetReader trả về pipe để đọc dữ liệu H264
func (m *CameraManager) GetReader() io.Reader {
	return m.pipeReader
}

// Stop dừng camera hoàn toàn
func (m *CameraManager) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
	}
}
