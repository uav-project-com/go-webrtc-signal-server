To create a simple WebRTC DataChannel between two peers using JavaScript and WebSockets, follow these steps:

### **Steps Overview**
1. **Set up a WebSocket signaling server** to exchange WebRTC offer/answer and ICE candidates.
2. **Create a WebRTC connection** on both peers.
3. **Establish a DataChannel** and send messages.

---

## **1. WebSocket Signaling Server (Node.js)**
You'll need a basic WebSocket server for signaling.

```javascript
const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3000 });

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        // Broadcast the message to all connected clients except sender
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });
});
```

Run this with:
```
node server.js
```

---

## **2. Client-Side JavaScript (WebRTC & WebSocket)**
This code runs in the browser.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>WebRTC DataChannel</title>
</head>
<body>
    <button onclick="sendMessage()">Send Message</button>
    <script>
        const ws = new WebSocket("ws://localhost:3000");
        const peer = new RTCPeerConnection();
        let dataChannel;

        ws.onmessage = async (event) => {
            const message = JSON.parse(event.data);

            if (message.offer) {
                await peer.setRemoteDescription(new RTCSessionDescription(message.offer));
                const answer = await peer.createAnswer();
                await peer.setLocalDescription(answer);
                ws.send(JSON.stringify({ answer }));
            } else if (message.answer) {
                await peer.setRemoteDescription(new RTCSessionDescription(message.answer));
            } else if (message.ice) {
                await peer.addIceCandidate(new RTCIceCandidate(message.ice));
            }
        };

        peer.onicecandidate = (event) => {
            if (event.candidate) {
                ws.send(JSON.stringify({ ice: event.candidate }));
            }
        };

        peer.ondatachannel = (event) => {
            dataChannel = event.channel;
            dataChannel.onmessage = (e) => console.log("Received:", e.data);
        };

        async function startConnection() {
            dataChannel = peer.createDataChannel("chat");
            dataChannel.onopen = () => console.log("DataChannel Open");
            dataChannel.onmessage = (e) => console.log("Received:", e.data);

            const offer = await peer.createOffer();
            await peer.setLocalDescription(offer);
            ws.send(JSON.stringify({ offer }));
        }

        function sendMessage() {
            if (dataChannel && dataChannel.readyState === "open") {
                dataChannel.send("Hello Peer!");
            }
        }

        startConnection();
    </script>
</body>
</html>
```

---

## **How It Works**
1. Each peer connects to the **WebSocket server** for signaling.
2. One peer creates an **offer** and sends it through WebSocket.
3. The other peer receives the offer, creates an **answer**, and sends it back.
4. Both peers exchange **ICE candidates** to establish a direct WebRTC connection.
5. A **DataChannel** is created and used for peer-to-peer communication.

---

## **Test It**
1. Start the WebSocket server:  
```bash
npm install ws
# for test:
npm install wscat  --save-dev
# run server:
node server.js
```
2. Open the HTML file in **two different browser tabs**.
3. Click the **Send Message** button to send data between the peers.

This is the **simplest** WebRTC DataChannel setup. Let me know if you need improvements! 🚀