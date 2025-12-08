Go DataChannel client (port of webrtc-common/data-channel.service.ts)

This package provides a lightweight data-channel client using Pion WebRTC and a simple WebSocket signaling wrapper.

Files added:

- `signal_msg.go` : Signal message DTOs and enums
- `websocket.go`   : WebSocket client wrapper (uses `github.com/gorilla/websocket`)
- `data_channel.go`: DataChannelClient implementation using `github.com/pion/webrtc/v4`
- `consts.go`      : small constant used for join request

Basic usage example:

```go
client, err := NewDataChannelClient("my-user", "room1", false, "ws://localhost:8080/ws")
if err != nil {
    panic(err)
}
defer client.Close()

// send a message to all peers
client.SendMsg("hello from go client")
```

Notes:

- Signaling message payloads follow the same pattern as the TypeScript library (base64-encoded JSON containing `{type, sdp}` or `{type, sdp: candidate}`).
- This implementation is a starting point — you may want to add proper error handling, reconnection logic, and event callbacks to integrate with your application.
