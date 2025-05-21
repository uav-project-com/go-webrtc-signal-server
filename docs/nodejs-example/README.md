# Simple example call Webrtc with room server
> Hieu19926@gmail.com - https://chatgpt.com/c/682df48e-85a8-8002-9703-2955ef0447f9
### Structure
```
webrtc-room-demo/
├── server.js
├── public/
│   └── index.html
└── package.json
```

### Test
```bash
npm i
node server.js
#    Sau đó truy cập:
#    
#    Alice: http://localhost:8080/?room=testroom
#    
#    Bob: http://localhost:8080/?room=testroom (ở tab khác hoặc máy khác cùng mạng)


```
## 🔍 Những điểm có console.log():
| Event                  | Log                                            |
| ---------------------- | ---------------------------------------------- |
| Get user media         | `Got local media stream`                       |
| Join room              | `Joining room: <room>`                         |
| Room created           | `Room created, waiting for peer...`            |
| Room joined            | `Joined room, waiting for offer...`            |
| Peer ready             | `Second peer joined. Ready to start call.`     |
| Start peer             | `Starting peer connection. Caller: true/false` |
| Offer sent             | `Sending offer`                                |
| Offer received         | `Received offer`                               |
| Answer sent            | `Sending answer`                               |
| Answer received        | `Received answer`                              |
| ICE candidate sent     | `Sending ICE candidate`                        |
| ICE candidate received | `Received ICE candidate`                       |
| Track received         | `Received remote track`                        |
| ICE state changes      | `ICE connection state: <state>`                |

## 🚀 Gợi ý mở rộng WebRTC Room App
| Tính năng                         | Mô tả                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------- |
| 🔗 **Tạo link phòng tự động**     | Tạo URL như `?room=abc123` bằng `Math.random().toString(36).substring(2, 8)` |
| 📸 **Chụp ảnh từ remote stream**  | Dùng canvas để snapshot khung hình từ `remoteVideo`                          |
| 🔊 **Mute/Unmute, Camera on/off** | Dùng `track.enabled = false` để tắt/mở video/audio                           |
| 💬 **Chat realtime**              | Gửi message qua Socket.io hoặc WebRTC DataChannel                            |
| 📱 **Responsive UI**              | Giao diện gọn nhẹ cho mobile/tablet                                          |
| 🧪 **Kiểm tra tốc độ kết nối**    | Thêm stats từ `getStats()` để đo bitrate, packet loss                        |
