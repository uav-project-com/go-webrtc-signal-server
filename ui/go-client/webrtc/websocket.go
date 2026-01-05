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
// Updated to support multiple subscribers (Broadcast).
type WebsocketClient struct {
	url         string
	conn        *websocket.Conn
	subscribers []chan []byte
	mu          sync.Mutex
}

func NewWebsocketClient(url string) *WebsocketClient {
	return &WebsocketClient{
		url:         url,
		subscribers: make([]chan []byte, 0),
	}
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
	defer func() {
		w.mu.Lock()
		for _, ch := range w.subscribers {
			close(ch)
		}
		w.subscribers = nil // clear subscribers
		w.conn = nil
		w.mu.Unlock()
	}()

	for {
		if w.conn == nil {
			return
		}
		_, msg, err := w.conn.ReadMessage()
		if err != nil {
			log.Printf("websocket read error: %v", err)
			return
		}
		// Broadcast message to all subscribers
		w.mu.Lock()
		for _, ch := range w.subscribers {
			// Non-blocking send to avoid one slow subscriber blocking others
			select {
			case ch <- msg:
			default:
				log.Println("Warning: dropping message for slow subscriber")
			}
		}
		w.mu.Unlock()
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

// GetMessages returns a new channel that receives all incoming messages.
func (w *WebsocketClient) GetMessages() <-chan []byte {
	w.mu.Lock()
	defer w.mu.Unlock()
	ch := make(chan []byte, 64)
	w.subscribers = append(w.subscribers, ch)
	return ch
}

func (w *WebsocketClient) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.conn != nil {
		_ = w.conn.Close()
		// readLoop will handle cleanup
	}
	return nil
}
