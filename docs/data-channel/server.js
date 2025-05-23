const WebSocket = require("ws");

const wss = new WebSocket.Server({ port: 3000 });

wss.on("connection", (ws) => {
    ws.on("message", (message) => {
        console.log(`received message: ${message}`)
        // Broadcast the message to all connected clients except sender
        wss.clients.forEach(client => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    });
});
