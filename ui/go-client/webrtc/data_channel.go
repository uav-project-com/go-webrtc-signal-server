package webrtc

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"sync"

	pionwebrtc "github.com/pion/webrtc/v4"
)

// DataChannelClient is a Go port of the TypeScript DataChannelService.
type DataChannelClient struct {
	userID   string
	roomID   string
	isMaster bool

	ws *WebsocketClient

	config pionwebrtc.Configuration

	mu                sync.Mutex
	peers             map[string]*pionwebrtc.PeerConnection
	dataChannels      map[string]*pionwebrtc.DataChannel
	pendingCandidates map[string][]pionwebrtc.ICECandidateInit
}

// NewDataChannelClient creates and connects the signaling websocket and prepares handlers.
func NewDataChannelClient(userID, roomID string, isMaster bool, socketURL string) (*DataChannelClient, error) {
	c := &DataChannelClient{
		userID:   userID,
		roomID:   roomID,
		isMaster: isMaster,
		config: pionwebrtc.Configuration{
			ICEServers: []pionwebrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}},
		},
		peers:             make(map[string]*pionwebrtc.PeerConnection),
		dataChannels:      make(map[string]*pionwebrtc.DataChannel),
		pendingCandidates: make(map[string][]pionwebrtc.ICECandidateInit),
	}

	ws := NewWebsocketClient(socketURL)
  if err := ws.Connect(roomID, &userID); err != nil {
		return nil, err
	}
	c.ws = ws

	// Start listening messages
	go c.listenSignaling()

	return c, nil
}

// listenSignaling consumes messages from websocket and dispatches handlers.
func (c *DataChannelClient) listenSignaling() {
	msgs := c.ws.GetMessages()
	for raw := range msgs {
		if raw == nil {
			continue
		}
		var msg SignalMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("invalid signaling msg: %v", err)
			continue
		}
		log.Printf("received ws: %+v", msg)
		// Auto init data channel on onConnected
		if msg.Status == 200 {
			if s, ok := msg.Msg.(string); ok && len(s) >= 11 && s[:11] == "onConnected" {
				c.initDataChannel()
				continue
			}
		}

		// Handle base64 payloads similar to TS implementation
		if msg.Channel != nil && *msg.Channel == ChannelDataRtc {
			c.handleSignalingData(&msg)
		}
	}
}

func (c *DataChannelClient) initDataChannel() {
	if !c.isMaster {
		// send request join
		m := SignalMsg{Msg: RequestJoinDataChannel, From: c.userID, RoomId: c.roomID}
		_ = c.ws.Send(m)
	}
}

func (c *DataChannelClient) handleSignalingData(message *SignalMsg) {
	// msg may be base64 encoded JSON. Try to decode string payload.
	var payload interface{}
	switch v := message.Msg.(type) {
	case string:
		// Attempt base64 decode then json
		if isBase64(v) {
			b, err := base64.StdEncoding.DecodeString(v)
			if err == nil {
				_ = json.Unmarshal(b, &payload)
			}
		} else {
			_ = json.Unmarshal([]byte(v), &payload)
		}
	default:
		payload = v
	}

	dataMap, _ := payload.(map[string]interface{})
	if dataMap == nil {
		return
	}
	t, _ := dataMap["type"].(string)
	sid := message.From
	if sid == c.userID {
		return
	}
	switch t {
	case "offer":
		// create peer if not exist
		if _, ok := c.peers[sid]; !ok {
			_ = c.createDataChannelConnection(sid, false)
		}
		// set remote desc and answer
		// Note: pion expects RTCSessionDescriptionInit structure
		if sdpMap, ok := dataMap["sdp"].(map[string]interface{}); ok {
			sdpBytes, _ := json.Marshal(sdpMap)
			var desc pionwebrtc.SessionDescription
			_ = json.Unmarshal(sdpBytes, &desc)
			peer := c.peers[sid]
			if peer != nil {
				if err := peer.SetRemoteDescription(desc); err != nil {
					log.Printf("SetRemoteDescription error: %v", err)
				}
				answer, err := peer.CreateAnswer(nil)
				if err == nil {
					if err := peer.SetLocalDescription(answer); err == nil {
						// send answer
						msgObj := map[string]interface{}{"type": answer.Type.String(), "sdp": peer.LocalDescription()}
						enc, _ := json.Marshal(msgObj)
						m := SignalMsg{Channel: ptrChannel(ChannelDataRtc), Msg: base64.StdEncoding.EncodeToString(enc), From: c.userID, To: sid, RoomId: c.roomID}
						_ = c.ws.Send(m)
					}
				}
			}
		}
	case "answer":
		if sdpMap, ok := dataMap["sdp"].(map[string]interface{}); ok {
			sdpBytes, _ := json.Marshal(sdpMap)
			var desc pionwebrtc.SessionDescription
			_ = json.Unmarshal(sdpBytes, &desc)
			if peer := c.peers[sid]; peer != nil {
				_ = peer.SetRemoteDescription(desc)
			}
		}
	case "candidate":
		if cand, ok := dataMap["sdp"].(map[string]interface{}); ok {
			candBytes, _ := json.Marshal(cand)
			var ci pionwebrtc.ICECandidateInit
			_ = json.Unmarshal(candBytes, &ci)
			if peer, ok := c.peers[sid]; ok && peer.RemoteDescription() != nil {
				_ = peer.AddICECandidate(ci)
			} else {
				c.addPendingCandidate(sid, ci)
			}
		}
	default:
	}
}

func (c *DataChannelClient) addPendingCandidate(sid string, ci pionwebrtc.ICECandidateInit) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pendingCandidates[sid] = append(c.pendingCandidates[sid], ci)
}

func (c *DataChannelClient) getAndClearPendingCandidates(sid string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	list := c.pendingCandidates[sid]
	for _, cand := range list {
		if pc := c.peers[sid]; pc != nil {
			_ = pc.AddICECandidate(cand)
		}
	}
	c.pendingCandidates[sid] = nil
}

func (c *DataChannelClient) createDataChannelConnection(sid string, isCaller bool) error {
	log.Printf("setup data channel for %s", sid)
	pc, err := pionwebrtc.NewPeerConnection(c.config)
	if err != nil {
		return err
	}
	c.peers[sid] = pc

	pc.OnICECandidate(func(ci *pionwebrtc.ICECandidate) {
		if ci == nil {
			return
		}
		j, _ := json.Marshal(map[string]interface{}{"type": "candidate", "sdp": ci.ToJSON()})
		m := SignalMsg{Channel: ptrChannel(ChannelDataRtc), Msg: base64.StdEncoding.EncodeToString(j), From: c.userID, To: sid, RoomId: c.roomID}
		_ = c.ws.Send(m)
	})

	pc.OnDataChannel(func(d *pionwebrtc.DataChannel) {
		d.OnMessage(func(msg pionwebrtc.DataChannelMessage) {
			log.Printf("Received message from %s: %s", sid, string(msg.Data))
			// Could dispatch to listeners via channels or callbacks
		})
		d.OnOpen(func() { log.Printf("DataChannel Open for %s", sid) })
		c.dataChannels[sid] = d
	})

	if isCaller {
		dc, err := pc.CreateDataChannel("chat", nil)
		if err == nil {
			dc.OnMessage(func(msg pionwebrtc.DataChannelMessage) {
				log.Printf("Received message from %s: %s", sid, string(msg.Data))
			})
			c.dataChannels[sid] = dc
		}
		offer, err := pc.CreateOffer(nil)
		if err == nil {
			_ = pc.SetLocalDescription(offer)
			obj := map[string]interface{}{"type": offer.Type.String(), "sdp": pc.LocalDescription()}
			enc, _ := json.Marshal(obj)
			m := SignalMsg{Channel: ptrChannel(ChannelDataRtc), Msg: base64.StdEncoding.EncodeToString(enc), From: c.userID, To: sid, RoomId: c.roomID}
			_ = c.ws.Send(m)
		}
	}

	pc.OnConnectionStateChange(func(state pionwebrtc.PeerConnectionState) {
		log.Printf("connectionstatechange-state: %s", state.String())
		if state == pionwebrtc.PeerConnectionStateConnected {
			log.Printf("datachannel connected for %s", sid)
			c.getAndClearPendingCandidates(sid)
		}
	})
	return nil
}

// SendMsg broadcasts text message to all open data channels
func (c *DataChannelClient) SendMsg(message string) {
	for sid, ch := range c.dataChannels {
		if ch != nil {
			if err := ch.SendText(message); err != nil {
				log.Printf("send to %s error: %v", sid, err)
			}
		}
	}
}

// Close cleans up resources
func (c *DataChannelClient) Close() {
	c.ws.Close()
	for _, pc := range c.peers {
		_ = pc.Close()
	}
}

// helpers
func isBase64(s string) bool {
	_, err := base64.StdEncoding.DecodeString(s)
	return err == nil
}

func ptrChannel(ch Channel) *Channel { return &ch }
