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