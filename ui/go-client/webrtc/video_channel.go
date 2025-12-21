package webrtc

import (
	"encoding/base64"
	"encoding/json"
	"log"
	"sync"

	pionwebrtc "github.com/pion/webrtc/v4"
)

// VideoChannelClient is a Go port of the TypeScript VideoChannelService.
// Note: Browsers' getUserMedia is not available in Go; callers must provide local tracks via SetLocalTrack.
type VideoChannelClient struct {
	userID   string
	roomID   string
	isMaster bool

	config pionwebrtc.Configuration

	mu    sync.Mutex
	peers map[string]*pionwebrtc.PeerConnection
	// store inbound tracks per peer
	streams           map[string][]*pionwebrtc.TrackRemote
	pendingCandidates map[string][]pionwebrtc.ICECandidateInit

	localTracks []*pionwebrtc.TrackLocalStaticSample

	websocket *WebsocketClient

	remoteListeners []func([]*pionwebrtc.TrackRemote, string)
}

// NewVideoChannelClient constructs the client and connects to signaling websocket.
func NewVideoChannelClient(userID, roomName string, isMaster bool, socketURL string, signalServers ...pionwebrtc.ICEServer) (*VideoChannelClient, error) {
	cfg := pionwebrtc.Configuration{}
	if len(signalServers) > 0 {
		cfg.ICEServers = signalServers
	} else {
		cfg.ICEServers = []pionwebrtc.ICEServer{{URLs: []string{"stun:stun.l.google.com:19302"}}}
	}

	c := &VideoChannelClient{
		userID:            userID,
		roomID:            roomName,
		isMaster:          isMaster,
		config:            cfg,
		peers:             make(map[string]*pionwebrtc.PeerConnection),
		streams:           make(map[string][]*pionwebrtc.TrackRemote),
		pendingCandidates: make(map[string][]pionwebrtc.ICECandidateInit),
	}

	ws := NewWebsocketClient(socketURL)
	if err := ws.Connect(roomName, &userID); err != nil {
		return nil, err
	}
	c.websocket = ws
	go c.listenSignaling()
	return c, nil
}

func (c *VideoChannelClient) listenSignaling() {
	msgs := c.websocket.GetMessages()
	for raw := range msgs {
		if raw == nil {
			continue
		}
		var msg SignalMsg
		if err := json.Unmarshal(raw, &msg); err != nil {
			log.Printf("invalid signaling msg: %v", err)
			continue
		}
		log.Printf("video ws: %+v", msg)
		if msg.Status == 200 {
			if s, ok := msg.Msg.(string); ok && len(s) >= 11 && s[:11] == "onConnected" {
				c.initVideoCall()
				continue
			}
		}
		if msg.Channel != nil && *msg.Channel == ChannelWebrtc {
			c.handleSignalingData(&msg)
		}
	}
}

func (c *VideoChannelClient) initVideoCall() {
	// In TS this calls toggleLocalVideo(true) and sends REQUEST_JOIN_MEDIA_CHANNEL
	// Here we just send the join request when not master
	if !c.isMaster {
    m := SignalMsg{Msg: RequestJoinMediaChannel, From: c.userID, RoomId: c.roomID, Channel: getValue(ChannelWebrtc)}
		_ = c.websocket.Send(m)
	}
}

func (c *VideoChannelClient) handleSignalingData(message *SignalMsg) {
	// decode base64 payload similar to TS
	var payload interface{}
	switch v := message.Msg.(type) {
	case string:
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
		if _, ok := c.peers[sid]; !ok {
			_ = c.createVideoPeerConnection(sid, false)
		}
		if sdpMap, ok := dataMap["sdp"].(map[string]interface{}); ok {
			sdpBytes, _ := json.Marshal(sdpMap)
			var desc pionwebrtc.SessionDescription
			_ = json.Unmarshal(sdpBytes, &desc)
			if peer := c.peers[sid]; peer != nil {
				_ = peer.SetRemoteDescription(desc)
				answer, err := peer.CreateAnswer(nil)
				if err == nil {
					_ = peer.SetLocalDescription(answer)
					msgObj := map[string]interface{}{"type": answer.Type.String(), "sdp": peer.LocalDescription()}
					enc, _ := json.Marshal(msgObj)
          m := SignalMsg{Channel: getValue(ChannelWebrtc), Msg: base64.StdEncoding.EncodeToString(enc), From: c.userID, To: sid, RoomId: c.roomID}
					_ = c.websocket.Send(m)
				}
				c.getAndClearPendingCandidates(sid)
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
				c.addPendingCandidates(sid, ci)
			}
		}
	}
}

func (c *VideoChannelClient) addPendingCandidates(sid string, candidate pionwebrtc.ICECandidateInit) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.pendingCandidates[sid] = append(c.pendingCandidates[sid], candidate)
}

func (c *VideoChannelClient) getAndClearPendingCandidates(sid string) {
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

func (c *VideoChannelClient) createVideoPeerConnection(sid string, isCaller bool) error {
	pc, err := pionwebrtc.NewPeerConnection(c.config)
	if err != nil {
		return err
	}
	c.peers[sid] = pc

	// Add local tracks to peer
	for _, t := range c.localTracks {
		_, _ = pc.AddTrack(t)
	}

	pc.OnICECandidate(func(ci *pionwebrtc.ICECandidate) {
		if ci == nil {
			return
		}
		j, _ := json.Marshal(map[string]interface{}{"type": "candidate", "sdp": ci.ToJSON()})
    m := SignalMsg{Channel: getValue(ChannelWebrtc), Msg: base64.StdEncoding.EncodeToString(j), From: c.userID, To: sid, RoomId: c.roomID}
		_ = c.websocket.Send(m)
	})

	pc.OnTrack(func(track *pionwebrtc.TrackRemote, receiver *pionwebrtc.RTPReceiver) {
		c.mu.Lock()
		c.streams[sid] = append(c.streams[sid], track)
		c.mu.Unlock()
		// notify listeners
		for _, l := range c.remoteListeners {
			l(c.streams[sid], sid)
		}
	})

	pc.OnConnectionStateChange(func(state pionwebrtc.PeerConnectionState) {
		log.Printf("connectionState: %s", state.String())
		if state == pionwebrtc.PeerConnectionStateConnected {
			c.getAndClearPendingCandidates(sid)
		}
	})

	if isCaller {
		offer, err := pc.CreateOffer(nil)
		if err == nil {
			_ = pc.SetLocalDescription(offer)
			obj := map[string]interface{}{"type": offer.Type.String(), "sdp": pc.LocalDescription()}
			enc, _ := json.Marshal(obj)
      m := SignalMsg{Channel: getValue(ChannelWebrtc), Msg: base64.StdEncoding.EncodeToString(enc), From: c.userID, To: sid, RoomId: c.roomID}
			_ = c.websocket.Send(m)
		}
	}
	return nil
}

// Public Api ------------------------------------------------

// Close tears down connections and websocket
func (c *VideoChannelClient) Close() {
	c.websocket.Close()
	for _, pc := range c.peers {
		_ = pc.Close()
	}
}

// SetLocalTrack allows caller to provide a local TrackLocal (e.g., audio/video source). The implementation
// will add the track to existing peer connections and store for future peers.
func (c *VideoChannelClient) SetLocalTrack(t *pionwebrtc.TrackLocalStaticSample) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.localTracks = append(c.localTracks, t)
	for _, pc := range c.peers {
		_, _ = pc.AddTrack(t)
	}
}

// GetRemoteStreams returns the map of remote tracks per peer id
func (c *VideoChannelClient) GetRemoteStreams() map[string][]*pionwebrtc.TrackRemote {
	return c.streams
}

// AddOnRemoteStreamListener registers a listener invoked when a remote track/stream arrives
func (c *VideoChannelClient) AddOnRemoteStreamListener(listener func([]*pionwebrtc.TrackRemote, string)) {
	c.remoteListeners = append(c.remoteListeners, listener)
}

// AddOnLocalStream mirrors the TS Api but in Go it's a hint: callers should set local tracks via SetLocalTrack.
// The provided callback is invoked immediately to let callers create local tracks if they can.
func (c *VideoChannelClient) AddOnLocalStream(cb func()) {
	go func() {
		cb()
	}()
}

// ToggleLocalVideo and ToggleLocalMic attempt to enable/disable local tracks
func (c *VideoChannelClient) ToggleLocalVideo(enable bool) {
	// Pion TrackLocalStaticSample does not expose enabled flag; this is a no-op placeholder.
}

func (c *VideoChannelClient) ToggleLocalMic(enable bool) {
	// Placeholder: implement as needed by managing audio tracks
}

// getValue is defined in another file (data_channel.go) in this package.
