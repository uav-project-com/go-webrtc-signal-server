# Project Context: Go WebRTC Signal Server

## Overview

This project is a WebRTC signal server implemented in Go using the Gin framework. It facilitates WebRTC connections via WebSockets and provides a demonstration of data channel and video call capabilities. The project also includes a legacy or demonstration CRUD API for "Products" backed by PostgreSQL.

The system consists of:
1.  **Backend:** A Go server handling HTTP requests and WebSocket connections for signaling.
2.  **Frontend:** An Angular 19 application providing the user interface for video calls and data exchange.
3.  **Common Library:** A TypeScript library (`webrtc-common`) shared by the frontend.

## Architecture

*   **Language:** Go (Backend), TypeScript (Frontend)
*   **Frameworks:**
    *   **Backend:** Gin (HTTP Web Framework), Pion WebRTC (WebRTC implementation in Go), Gorm (ORM).
    *   **Frontend:** Angular 19.
*   **Database:** PostgreSQL.
*   **Signaling:** WebSockets are used to exchange SDP offers/answers and ICE candidates.
*   **Configuration:** `app-dev.yaml` handles server and database configuration.

## Directory Structure

*   `main.go`: Entry point for the Go backend.
*   `app-dev.yaml`: Configuration file for the backend (DB credentials, STUN servers, ports).
*   `config/`: Configuration loaders and database connection logic.
*   `controllers/`: HTTP and WebSocket handlers (`product_api.go`, `webrtc_api.go`).
*   `service/`: Business logic (`product.go`, `webrtc.go`).
*   `repo/`: Data access layer.
*   `routes/`: API route definitions.
*   `ui/`: The Angular frontend application.
    *   `ui/src/`: Source code for the Angular app.
    *   `ui/webrtc-common/`: Shared TypeScript library for WebRTC logic.
*   `docs/`: Documentation and diagrams (`go-webrtc.drawio`, `Architecture.jpg`).

## Building and Running

### Prerequisites

*   Go 1.22+
*   Node.js v22+ (for Angular)
*   PostgreSQL
*   Docker (optional, for running Postgres)

### Backend

1.  **Configuration:**
    Ensure `app-dev.yaml` is configured correctly with your PostgreSQL credentials.
    ```yaml
    app:
      port: 8080
    database:
      host: "172.29.96.1" # Update as needed
      port: 5432
      username: "postgres"
      password: "password"
      name: "h_engine"
    ```

2.  **Run:**
    ```bash
    go mod tidy
    go run main.go
    ```
    The server typically starts on port `8080`.

### Frontend

1.  **Navigate to UI directory:**
    ```bash
    cd ui
    ```

2.  **Install Dependencies:**
    ```bash
    npm install
    ```

3.  **Build Common Library:**
    The Angular app depends on the local `webrtc-common` package.
    ```bash
    npm run common
    ```

4.  **Run Angular App:**
    ```bash
    npm start
    ```
    This runs `ng serve --configuration development --host 0.0.0.0`. Access the app at `http://localhost:4200`.

## Key Features

*   **WebRTC Signaling:** Handles WebSocket connections at `/ws/join/:roomId/c/:userId`.
*   **Product CRUD:** Sample API endpoints at `/products`.
*   **IP Logging:** Middleware to log request IP addresses.

## Development Conventions

*   **Go:** Follows a layered architecture (Controller -> Service -> Repository).
*   **Angular:** Standard Angular CLI project structure.
*   **WebRTC:** Uses the `pion/webrtc` library on the backend and native WebRTC APIs (wrapped in `webrtc-common`) on the frontend.

## Convert video mp4 for test localhost go-client
```bash
ffmpeg -i video_h264.mp4 -c:v libx264 -profile:v baseline -level 3.1 -pix_fmt yuv420p -an -bsf:v h264_mp4toannexb -f h264 video.h264
```

## Thứ tự test WebRTC:
1. Run `go-webrtc-signal-server`
2. `cd ui && npm start`
3. Open `http://localhost:4200` in 1 browser tab
4. Run inside wsl/linux: `cd ui/webrtc-client-go && go run main.go`
5. Call e2e api order: 1, 2
6. Join default room in browser: 24G-ZT0-Q8T
7. Click on icon Video in Browser.

# PRODUCTION!

Tóm tắt thay đổi:
1. Chế độ DEV (`APP_ENV=dev`):
    * Đọc file tại đường dẫn cố định /home/assmin/video.h264.
    * Có cơ chế tự động mở lại file khi kết thúc (looping).
    * Sử dụng time.Ticker (33ms) để kiểm soát tốc độ gửi dữ liệu, tránh việc gửi quá nhanh làm tràn bộ đệm trình duyệt.
2. Chế độ PRODUCTION:
    * Đọc dữ liệu trực tiếp từ os.Stdin.
    * Gửi dữ liệu đi ngay khi nhận được NAL unit (phù hợp với việc nhận luồng trực tiếp từ camera qua ống dẫn pipe).
    * Loại bỏ bộ định thời (ticker) vì phần cứng camera đã đảm nhận việc duy trì FPS.

Cách sử dụng trên Raspberry Pi 5:
Khi bạn muốn dùng camera thật, hãy chạy lệnh sau:

`libcamera-vid -t 0 --inline --width 1280 --height 720 --framerate 30 --codec h264 -o - | ./uav-go-client`

Nếu bạn muốn test bằng file ở chế độ dev:
1 export APP_ENV=dev
2 ./uav-go-client

## Enhancements
> Tôi thấy dùng pipeline khá chuyên nghiệp, nhưng muốn sử dụng các tính năng của camera phải làm như nào (thay đổi tiêu cự, lấy nét, reset cam, đổi sang mắt cam khác...)?

✦ Để điều khiển các tính năng chuyên sâu của camera (tiêu cự, lấy nét, đổi mắt cam...) trong khi vẫn duy trì Pipeline, bạn có 3 hướng tiếp cận chính từ mức độ dễ đến chuyên nghiệp:

### 1. Sử dụng v4l2-ctl (Cách nhanh nhất)                                                                                                                                                                                                                                                                                                    
   Dù bạn đang chạy libcamera-vid, hệ điều hành Linux vẫn cho phép bạn can thiệp vào các tham số của phần cứng thông qua giao thức V4L2 (Video for Linux 2).

* Lấy nét (Focus): Nếu bạn dùng Camera Module 3 (có autofocus), bạn có thể dùng lệnh:

```bash
# Chuyển sang lấy nét thủ công và đặt tiêu cự (giá trị từ 0.0 đến khoảng 10.0)
v4l2-ctl -d /dev/v4l-subdevX --set-ctrl=focus_absolute=500
```
* Cách Go-client điều khiển: Khi nhận được lệnh từ Data Channel (ví dụ: {"cmd": "focus", "val": 500}), Go-client sẽ thực thi lệnh shell:
```go
// Trong uav_api.go
exec.Command("v4l2-ctl", "-d", "/dev/v4l-subdevX", "--set-ctrl", "focus_absolute=500").Run()
```

### 2. Khởi động lại Pipeline (Dành cho việc đổi mắt Cam/Reset)
   Trên Raspberry Pi 5, việc chuyển đổi giữa Camera 0 và Camera 1 (CSI0/CSI1) yêu cầu phải giải phóng bus phần cứng. Cách "sạch" nhất là khởi động lại tiến trình libcamera-vid.

* Cách làm: Go-client sẽ quản lý tiến trình camera như một Child Process.
* Logic:
    1. Nhận lệnh switch-camera.
    2. Kill tiến trình libcamera-vid hiện tại.
    3. Chạy lại lệnh mới với tham số --camera 1 hoặc --camera 0.
    4. Vì WebRTC Data Channel vẫn sống, kết nối không bị mất, chỉ có luồng Video bị khựng khoảng 1-2 giây rồi có hình lại.

### 3. Sử dụng script "Sidecar" (Cách chuyên nghiệp cho UAV)
   Thay vì đẩy Pipe trực tiếp từ libcamera-vid, bạn có thể dùng một script Python nhỏ (sử dụng thư viện Picamera2) làm trung gian.

* Mô hình: Camera -> Script Python -> (Unix Socket/Pipe) -> Go-client.
* Ưu điểm: Script Python có thể lắng nghe lệnh từ Go-client qua một đường tín hiệu riêng (như local TCP hoặc file) để thay đổi thông số camera cực nhanh (Zoom, Focus, Exposure) bằng API chính thức của libcamera mà không bao giờ phải ngắt luồng video.

  ---

Gợi ý triển khai cho bạn:

Để bắt đầu ngay, bạn nên dùng Cách 2 kết hợp với lệnh shell. Tôi sẽ hướng dẫn bạn cách sửa Go-client để nó "quản lý" tiến trình camera thay vì bạn phải chạy tay ngoài terminal:

Bước 1: Sửa Go-client để tự chạy Camera
Thay vì dùng Stdin, Go-client sẽ tự gọi libcamera-vid và đọc dữ liệu từ đó.

```go
// Trong video_channel.go (Ví dụ logic)
func (c *VideoChannelClient) StartCamera(cameraIdx int) {
    args := []string{
        "-t", "0", "--inline", "--width", "1280", "--height", "720",
        "--framerate", "30", "--codec", "h264", "--camera", strconv.Itoa(cameraIdx), "-o", "-",
    }
    cmd := exec.Command("libcamera-vid", args...)
    stdout, _ := cmd.StdoutPipe() // Lấy đầu ra của camera
    cmd.Start()

    // Đưa stdout này vào H264Reader
    h264 := NewH264Reader(stdout)
    // ... loop đọc NAL như cũ ...
}
```

Bước 2: Điều khiển qua Data Channel
Khi bạn ở trên Chrome (Angular), bạn gửi một tin nhắn:
* {"action": "set-focus", "value": 10} -> Go nhận được, chạy v4l2-ctl.
* {"action": "switch-cam", "id": 1} -> Go nhận được, tắt cmd, chạy lại StartCamera(1).

Lời khuyên cho UAV:
* Reset Cam: Bạn nên gán một lệnh reset để kill và chạy lại camera nếu luồng hình ảnh bị đứng (thường gặp khi nhiễu điện trên UAV).
* Mắt Cam: Nếu UAV có 2 mắt (một mắt FPV góc rộng, một mắt Zoom), việc dùng Cách 2 là tối ưu nhất.

