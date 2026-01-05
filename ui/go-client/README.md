# Client Webrtc in Golang

## 1. Test websocket

wscat is a popular command-line WebSocket client. You can use it to test your WebSocket server.

### Steps:
Install wscat (requires Node.js and npm):
> cd ../ui
> 
> npm install -g wscat

Start the Go WebSocket server.
#### Connect to the WebSocket server using wscat:

> wscat -c ws://localhost:8080/ws

#### Send a message to the server:

> Hello, Server!

The server will echo the message back, and you’ll see it in the terminal.

#### Join room chat:
```bash
wscat -c ws://localhost:8080/ws/join/1234/c/alice
Connected (press CTRL+C to quit)
wscat -c ws://localhost:8080/ws/join/1234/c/bob
Connected (press CTRL+C to quit)
```
- log on server:
```log
[GIN-debug] Listening and serving HTTP on :8080
2025/02/21 15:56:45 main.go:31: server run in: 8080
2025/02/21 15:58:27 ip_logger.go:12: IP Address: 127.0.0.1
2025/02/21 15:58:27 webrtc.go:57: [1234] alice joined room 1234
2025/02/21 16:05:15 ip_logger.go:12: IP Address: 127.0.0.1
2025/02/21 16:05:15 webrtc.go:57: [1234] bob joined room 1234
```
- send a message:
 ```bash
// Alice typing:
> {"from":"alice","to":"bob","msg":"Hello Bob","roomId":"1234"}
> {"from":"bob","to":"alice","msg":"Nice 2 meet u","roomId":"1234"}
```
- log in server:
```log
2025/02/21 16:36:37 ip_logger.go:12: IP Address: 127.0.0.1
2025/02/21 16:36:37 webrtc.go:62: [1234] alice joined room 1234
2025/02/21 16:36:40 ip_logger.go:12: IP Address: 127.0.0.1
2025/02/21 16:36:40 webrtc.go:62: [1234] bob joined room 1234
2025/02/21 16:36:48 webrtc.go:93: Received: {alice bob Hello Bob 1234}
```
- log in Bob wscat client:
```log
Connected (press CTRL+C to quit)
< {"from":"alice","to":"bob","msg":"Hello Bob","roomId":"1234"}
```

## 2. WebRTC Golang client for UAV
### 1. Init project
```bash
cd go-webrtc-signal-server/ui/go-client
go mod init github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client
# update project lib
go mod tidy
```
## 3. Infrastructure
<style>img {background-color: white;}</style>
![infrastructure.png](../../docs/infrastructure.png)

- Pi5 project client location: `go-webrtc-signal-server/ui/go-client`
- Remote client web UI: `go-webrtc-signal-server/ui/src`
- Socket server (golang): `go-webrtc-signal-server/controllers)`

```cmd
## KILL golang process in Windows
PS C:\WINDOWS\system32> tasklist | findstr go
winlogon.exe                  1700 Console                    1      8,496 K
___138go_build_go_rest_ap    29664 Console                    1     18,040 K
goland64.exe                 31932 Console                    1  2,269,036 K
goland64.exe                  3512 Console                    1     51,504 K
goland64.exe                 18116 Console                    1     22,184 K
gopls.exe                     5844 Console                    1    573,040 K
gopls.exe                    32228 Console                    1     18,308 K
PS C:\WINDOWS\system32> taskkill /PID 29664 /F
```

## 4. Golang client communication
<style>img {background-color: white;}</style>
![golang-client.png](../../docs/golang-client.png)X:\workspace\0.FPV\go-webrtc-signal-server\docs\golang-client.png

# Room hard code DB: 24G-ZT0-Q8T

# UAV command list
| Command                    | msg-key                              | Description                  |
|----------------------------|:-------------------------------------|------------------------------|
| request_join_data_channel  | 839d6af5-be15-474d-81c8-f34200007d4c | Connect data channel Webrtc. |
| request_join_video_channel | 493aaf25-eea6-4f37-8f9f-eb4507811721 | Request video FPV.           |
|                            |                                      |                              |
|                            |                                      |                              |

## Cancel video example

`cancel` is the `context.CancelFunc` returned by `context.WithCancel`. Calling it signals the context's `Done()` channel, which causes the two goroutines in `setupTrackHandlers` (PLI ticker and RTP reader) to exit cleanly. The function is also called automatically inside `setupTrackHandlers` when the PeerConnection state becomes closed/failed/disconnected.

Brief example showing how to store and call `cancel` when removing/closing a peer:

Explanation: adds a `trackCancels` map to store cancels per-peer, appends the cancel returned by `setupTrackHandlers`, and calls them on `Close` to stop goroutines immediately.

```go
package webrtc

// Add field to VideoChannelClient:
// trackCancels map[string][]context.CancelFunc

// When handling OnTrack:
cancel := setupTrackHandlers(pc, track)
c.mu.Lock()
c.trackCancels[sid] = append(c.trackCancels[sid], cancel)
c.mu.Unlock()

// In Close (or when removing a peer):
c.mu.Lock()
for _, cancels := range c.trackCancels {
    for _, fn := range cancels {
        fn() // stop goroutines for that track
    }
}
c.mu.Unlock()
for _, pc := range c.peers {
    _ = pc.Close()
}
```

# Giả lập Video trong linux test e2e
Có — trên **Ubuntu bạn hoàn toàn có thể tạo camera “giả lập/ảo” để test `getUserMedia()` cho WebRTC**, và có vài cách phổ biến để làm điều này.

---

## 🛠️ 1. Dùng **v4l2loopback** để tạo Virtual Camera

### Giới thiệu

`v4l2loopback` là module cho Linux cho phép bạn tạo các **thiết bị video ảo** (`/dev/video*`) giống như webcam thật. Đây là cách phổ biến nhất để giả lập camera trong môi trường test. ([Cnblogs][1])

### Cách dùng

1. Cài đặt:

   ```bash
   sudo apt install v4l2loopback-dkms v4l2loopback-utils
   ```

2. Tạo camera ảo:

   ```bash
   sudo modprobe v4l2loopback devices=1 video_nr=10 card_label="VirtualCam" exclusive_caps=1
   ```

   → sẽ tạo thiết bị `/dev/video10`. ([Cnblogs][1])

3. Đưa video vào camera ảo (ví dụ từ file mp4/y4m):

   ```bash
   ffmpeg -re -i sample.mp4 -f v4l2 /dev/video10
   ```

4. Ở browser (Chrome/Firefox), khi gọi `navigator.mediaDevices.getUserMedia()`, bạn sẽ thấy và có thể chọn thiết bị **VirtualCam**.

📌 Ưu điểm:

* Hoạt động trên Ubuntu (V4L2)
* Hoàn toàn có thể dùng cho `getUserMedia()` trong trình duyệt
* Không cần hardware thật

📌 Nhược điểm:

* Phải có source video (file hoặc stream) đẩy vào thiết bị
* Một số app có thể yêu cầu restart Pipewire nếu camera không hiện (trên Ubuntu mới) ([Reddit][2])

---

## 📸 2. Dùng **OBS Studio Virtual Camera**

OBS có tính năng **Virtual Camera**:

* Bạn có thể đưa file video, webcam thật, hoặc scene vào obs và bắt đầu Virtual Camera.
* Ubuntu cũng hỗ trợ xuất Virtual Camera thông qua **v4l2loopback backend**. ([Reddit][3])

Cách:

1. Cài OBS:

   ```bash
   sudo apt install obs-studio
   ```
2. Bật Virtual Camera trong UI của OBS (“Start Virtual Camera”).
3. Chọn OBS Virtual Camera trong `getUserMedia()` trong trình duyệt.

⚠️ Có thể cần cài thêm `v4l2loopback` để OBS tạo thiết bị video ảo hoạt động ổn định trên Linux. ([Reddit][3])

---

## 💻 3. Dùng Chrome Flag Fake Devices (chỉ để test trình duyệt)

Chrome có flag để fake device mà không cần webcam:

```
--use-fake-device-for-media-stream
--use-file-for-fake-video-capture=/path/to/file.y4m
```

Ví dụ:

```bash
google-chrome \
  --use-fake-ui-for-media-stream \
  --use-fake-device-for-media-stream \
  --use-file-for-fake-video-capture=/home/user/test.y4m
```

→ Chrome sẽ hiện camera ảo, và dùng video từ file `test.y4m` để trả về cho `getUserMedia()`. ([webrtc.github.io][4])

**Lưu ý:** cách này *chỉ dùng để test trong Chrome*, không tạo camera ảo hệ thống.

---

## 📌 Tóm lại lựa chọn nào?

| Phương pháp                  | WebRTC getUserMedia | Cần phần cứng | Độ linh hoạt |
| ---------------------------- | ------------------- | ------------- | ------------ |
| **v4l2loopback + FFmpeg**    | ✔️                  | ❌             | ⭐⭐⭐⭐         |
| **OBS Virtual Camera**       | ✔️                  | ❌             | ⭐⭐⭐          |
| **Chrome fake device flags** | ✔️ (Chrome)         | ❌             | ⭐⭐           |

👉 Với test WebRTC thật trong trình duyệt hoặc WebRTC endpoint, **v4l2loopback** là cách mạnh nhất; còn nếu chỉ test nhanh trong Chrome thì có thể dùng flag `--use-fake-device-for-media-stream`. ([webrtc.github.io][4])

---

Nếu bạn muốn, tôi có thể gửi **bộ script mẫu để tự động tạo virtual camera + test UI getUserMedia**!

[1]: https://www.cnblogs.com/bigben0123/p/14143742.html?utm_source=chatgpt.com "ubuntu虚拟机下 虚拟摄像头 模拟摄像头 virtualCam - Bigben - 博客园"
[2]: https://www.reddit.com/r/Ubuntu/comments/1dk9hz2?utm_source=chatgpt.com "Ubuntu Camera Not working"
[3]: https://www.reddit.com/r/Ubuntu/comments/1e0kqoa?utm_source=chatgpt.com "OBS Studio failed to start virtual camera in Ubuntu 22.04"
[4]: https://webrtc.github.io/webrtc-org/testing/?utm_source=chatgpt.com "Testing | WebRTC"

