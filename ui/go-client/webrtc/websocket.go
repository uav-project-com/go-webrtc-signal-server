package webrtc

import (
  "encoding/json"
  "fmt"
  "log"
  "net/url"
  "sync"
  "time"

  "github.com/gorilla/websocket"
)

// WebsocketClient is a thin wrapper around gorilla/websocket to mimic the TS WebsocketService.
type WebsocketClient struct {
  url      string
  conn     *websocket.Conn
  messages chan []byte
  mu       sync.Mutex
}

func NewWebsocketClient(url string) *WebsocketClient {
  return &WebsocketClient{url: url, messages: make(chan []byte, 64)}
}

func (w *WebsocketClient) Connect(roomId string, userId *string) error {
  w.mu.Lock()
  defer w.mu.Unlock()
  if w.conn != nil {
    return nil
  }
  joinUrl := fmt.Sprintf("%s/join/%s/c/%s", w.url, roomId, *userId)
  log.Printf("connecting to: %s", joinUrl)

  // verify URL is valid
  if _, err := url.Parse(joinUrl); err != nil {
    return fmt.Errorf("invalid websocket url %q: %w", joinUrl, err)
  }

  dialer := websocket.DefaultDialer
  dialer.HandshakeTimeout = 5 * time.Second

  conn, resp, err := dialer.Dial(joinUrl, nil)
  if err != nil {
    if resp != nil {
      return fmt.Errorf("websocket dial error: %v (status: %s)", err, resp.Status)
    }
    return fmt.Errorf("websocket dial error: %w", err)
  }
  w.conn = conn
  go w.readLoop()
  return nil
}

func (w *WebsocketClient) readLoop() {
  for {
    _, msg, err := w.conn.ReadMessage()
    if err != nil {
      log.Printf("websocket read error: %v", err)
      close(w.messages)
      return
    }
    // push raw message bytes
    w.messages <- msg
  }
}

func (w *WebsocketClient) Send(message SignalMsg) error {
  w.mu.Lock()
  defer w.mu.Unlock()
  if w.conn == nil {
    return fmt.Errorf("not connected")
  }
  payload, err := json.Marshal(message)
  if err != nil {
    return err
  }
  return w.conn.WriteMessage(websocket.TextMessage, payload)
}

func (w *WebsocketClient) GetMessages() <-chan []byte {
  return w.messages
}

func (w *WebsocketClient) Close() error {
  w.mu.Lock()
  defer w.mu.Unlock()
  if w.conn != nil {
    _ = w.conn.Close()
    w.conn = nil
  }
  select {
  default:
  }
  return nil
}
