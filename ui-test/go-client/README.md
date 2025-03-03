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
