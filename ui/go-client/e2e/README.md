Run end-to-end tests (Node/Newman)

Prerequisites:
- Backend signaling server running at ws://localhost:8080
- HTTP client/API server running at http://localhost:3001
- From repository root run `cd ui/go-client/e2e && npm install` to install deps

Usage:
- Configure `.env` if needed (BACKEND_WS, CLIENT, ROOM_ID)
- Run `npm test` inside `ui/go-client/e2e`

What the script does:
1. Runs the Postman collection `0.webrtc.postman_collection.json` using Newman (this should exercise `/uav/start` requests).
2. Opens two WebSocket clients (anna/bob) to the signaling backend and sends a simple signaling message from `anna` to `bob` to validate the server forwards messages in the same room.

Notes:
- This script performs a lightweight smoke test of signaling and the `/uav/start` collection. For full WebRTC/data-channel coverage you need real browsers or headless WebRTC peers; this script focuses on exercising the signaling path.
