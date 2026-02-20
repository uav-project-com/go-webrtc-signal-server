package webrtc

import (
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/exec"
	"strconv"
	"sync"
	"syscall"
	"time"
)

// PiCameraManagerRpi manages the rpicam-vid/libcamera-vid process directly
// outputting an H.264 stream to stdout pipe
type PiCameraManagerRpi struct {
	mu       sync.Mutex
	cmd      *exec.Cmd
	stdout   io.ReadCloser
	settings CameraSettings

	exitChan chan error
}

// Check if PiCameraManagerRpi implements ICameraManager
var _ ICameraManager = (*PiCameraManagerRpi)(nil)

// Start bắt đầu tiến trình camera
func (m *PiCameraManagerRpi) Start() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.cmd != nil {
		return nil // Đã chạy rồi
	}

	// Kill any existing rpicam-vid and gst-launch processes
	log.Println("Camera Manager RPi: Force cleaning any existing camera processes...")
	_ = exec.Command("pkill", "-f", "rpicam-vid").Run()
	_ = exec.Command("pkill", "-f", "libcamera-vid").Run()
	_ = exec.Command("pkill", "-f", "gst-launch-1.0").Run()

	// Smart wait: Poll pgrep until process is gone (max 2s)
	for i := 0; i < 20; i++ {
		if err1 := exec.Command("pgrep", "-f", "rpicam-vid").Run(); err1 != nil {
			if err2 := exec.Command("pgrep", "-f", "libcamera-vid").Run(); err2 != nil {
				if err3 := exec.Command("pgrep", "-f", "gst-launch-1.0").Run(); err3 != nil {
					// All pgrep commands return exit code 1 if no process found -> Success!
					break
				}
			}
		}
		time.Sleep(100 * time.Millisecond)
	}

	return m.startProcess()
}

func (m *PiCameraManagerRpi) startProcess() error {
	log.Printf("PiCameraManagerRpi: Started for Camera %d", m.settings.CameraID)

	// Xây dựng tham số cho rpicam-vid
	args := []string{
		"-t", "0",
		"--inline",
		"--flush", // FIX: Ensure NALs are flushed out immediately without internal buffering
		"--width", strconv.Itoa(m.settings.Width),
		"--height", strconv.Itoa(m.settings.Height),
		"--framerate", strconv.Itoa(m.settings.FPS),
		"--codec", "h264",
		"--profile", "baseline",
		"--level", "4.2",
		"--camera", strconv.Itoa(m.settings.CameraID),
		"--libav-format", "h264", // Yêu cầu hệ thống đọc pipe theo định dạng H264 thuần
		"-o", "-", // Output to stdout
	}

	binary := "rpicam-vid"
	if _, err := exec.LookPath(binary); err != nil {
		binary = "libcamera-vid"
	}

	m.cmd = exec.Command(binary, args...)
	m.cmd.Stderr = os.Stderr

	stdout, err := m.cmd.StdoutPipe()
	if err != nil {
		return err
	}
	m.stdout = stdout

	// Create a new process group to kill all children later
	m.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := m.cmd.Start(); err != nil {
		return fmt.Errorf("failed to start %s: %v", binary, err)
	}

	log.Printf("Camera Manager RPi: %s PID: %d", binary, m.cmd.Process.Pid)
	log.Printf("Camera Manager RPi: Started pipeline for Camera %d (H.264 Pipe Mode)", m.settings.CameraID)

	// Monitor exit
	m.exitChan = make(chan error, 1)
	go func() {
		state, err := m.cmd.Process.Wait()
		if err != nil {
			log.Printf("Camera Manager RPi: Process.Wait() return error: %v", err)
			m.exitChan <- err
		} else {
			log.Printf("Camera Manager RPi: Process exited. Success: %v, Code: %d", state.Success(), state.ExitCode())
			m.exitChan <- nil
		}
	}()
	return nil
}

// Restart khởi động lại tiến trình
func (m *PiCameraManagerRpi) Restart() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	log.Println("Camera Manager RPi: Restarting...")
	if m.cmd != nil && m.cmd.Process != nil {
		_ = m.cmd.Process.Kill()
		_ = m.cmd.Wait()
	}
	m.cmd = nil
	return m.startProcess()
}

// SetFocus
func (m *PiCameraManagerRpi) SetFocus(val int) {
	m.settings.Focus = val
	// Use v4l2-ctl for autofocus logic if needed later
	log.Printf("SetFocus %d via v4l2-ctl is TODO", val)
}

// SetISO
func (m *PiCameraManagerRpi) SetISO(val int) {
	m.settings.ISO = val
	m.Restart()
}

// SwitchCamera
func (m *PiCameraManagerRpi) SwitchCamera(id int) {
	if m.settings.CameraID == id {
		return
	}
	m.settings.CameraID = id
	m.Restart()
}

// SetZoom
func (m *PiCameraManagerRpi) SetZoom(val float64) {
	if val < 1.0 {
		val = 1.0
	}
	m.settings.Zoom = val
	log.Printf("SetZoom %f not fully supported dynamically without restart yet", val)
}

// GetReader trả về pipe để đọc dữ liệu H264
func (m *PiCameraManagerRpi) GetReader() io.Reader {
	return m.stdout
}

// Stop dừng camera hoàn toàn
func (m *PiCameraManagerRpi) Stop() {
	m.mu.Lock()
	defer m.mu.Unlock()

	var pid int
	if m.cmd != nil && m.cmd.Process != nil {
		pid = m.cmd.Process.Pid
		// Attempt graceful shutdown with SIGTERM
		_ = syscall.Kill(-pid, syscall.SIGTERM)

		// Wait for exit or timeout
		select {
		case err := <-m.exitChan:
			log.Printf("Process exited gracefully: %v", err)
		case <-time.After(2000 * time.Millisecond):
			// Timeout, force kill
			log.Printf("Camera Manager RPi: SIGTERM timeout, forcing SIGKILL")
			_ = syscall.Kill(-pid, syscall.SIGKILL)

			// Wait again with short timeout to ensure reaping
			select {
			case err := <-m.exitChan:
				log.Printf("Process killed: %v", err)
			case <-time.After(1000 * time.Millisecond):
				log.Println("Camera Manager RPi: Process unresponsive to SIGKILL (Zombie?), abandoning.")
			}
		}
	} else {
		log.Println("Camera Manager RPi: Stop() called but cmd/Process is nil. Nothing to stop.")
	}
	m.cmd = nil
	// Smart wait: Verify process is truly gone from OS process table
	if pid > 0 {
		for i := 0; i < 20; i++ {
			// Sending signal 0 checks if process exists
			if err := syscall.Kill(pid, 0); errors.Is(err, syscall.ESRCH) {
				// ESRCH = No such process. Success!
				log.Printf("Camera Manager RPi: Process %d confirmed gone.", pid)
				break
			}
			time.Sleep(10 * time.Millisecond) // Poll fast
		}
	}
}

// IsRTP returns false for PiCameraManagerRpi because it outputs raw H.264 NAL Units, NOT RTP packets.
// Even though it uses UDP, it is NOT an RTP formatted stream like GStreamer's rtph264pay.
func (m *PiCameraManagerRpi) IsRTP() bool {
	return false
}
