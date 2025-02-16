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
