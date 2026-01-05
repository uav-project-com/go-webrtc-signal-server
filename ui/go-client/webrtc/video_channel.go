package webrtc

import (
  "context"
	"encoding/base64"
	"encoding/json"
  "io"
	"log"
  "os"
	"sync"
  "time"

  "github.com/pion/rtcp"
	pionwebrtc "github.com/pion/webrtc/v4"
  "github.com/pion/webrtc/v4/pkg/media"
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
  videoCtx    context.Context
  videoCancel context.CancelFunc

  websocket   *WebsocketClient
  dataChannel *DataChannelClient // Optional: for signaling via DataChannel

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

// NewVideoChannelClientWithWs constructs the client using an existing websocket client.
func NewVideoChannelClientWithWs(userID, roomName string, isMaster bool, ws *WebsocketClient, signalServers ...pionwebrtc.ICEServer) (*VideoChannelClient, error) {
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
    websocket:         ws,
  }

  go c.listenSignaling()
  return c, nil
}

// SetDataChannel injects the DataChannelClient to be used for signaling fallback/priority.
func (c *VideoChannelClient) SetDataChannel(dc *DataChannelClient) {
  c.mu.Lock()
  c.dataChannel = dc
  c.mu.Unlock()

  if dc != nil {
    log.Println("VideoChannelClient: DataChannel transport enabled.")
    dc.AddOnMessageEventListener(func(msgStr string) {
      var msg SignalMsg
      if err := json.Unmarshal([]byte(msgStr), &msg); err != nil {
        log.Printf("VideoChannelClient: Failed to parse DC msg: %v", err)
        return
      }
      // If 'from' is missing (implicit p2p), we might not be able to recover it easily
      // without extra info, but SignalMsg usually has it.
      c.processIncomingSignal(msg)
    })
  }
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
    c.processIncomingSignal(msg)
  }
}

// processIncomingSignal handles logic for both Websocket and DataChannel signals
func (c *VideoChannelClient) processIncomingSignal(msg SignalMsg) {
  log.Printf("video signal (src=%s): %+v", msg.From, msg)

  // 1. Handle OnConnected event (usually from WS)
  if msg.Status == 200 {
    if s, ok := msg.Msg.(string); ok && len(s) >= 11 && s[:11] == WebsocketConnected {
      c.initVideoCall()
      return
    }
  }

  // 2. Handle WebRTC Signaling Channel
  if msg.Channel != nil && *msg.Channel == ChannelWebrtc {
    if msg.Msg == RequestJoinMediaChannel {
      // Create peer connection to the joiner
      _ = c.createVideoPeerConnection(msg.From, c.isMaster)
    } else {
      // Handle SDP/Candidate exchange
      c.handleSignalingData(&msg)
    }
  }
}

// sendSignal sends a message via DataChannel if available, otherwise falls back to WebSocket.
func (c *VideoChannelClient) sendSignal(msg SignalMsg) error {
  // Try DataChannel first
  c.mu.Lock()
  dc := c.dataChannel
  c.mu.Unlock()

  if dc != nil {
    bytes, err := json.Marshal(msg)
    if err == nil {
      // DataChannelClient.SendMsg broadcasts to all peers.
      // Note: This might broadcast to peers who don't care, but that's how the mesh works currently.
      // Ideally, we should send to specific peer if possible, but the underlying DC client
      // currently only supports SendMsg (broadcast).
      dc.SendMsg(string(bytes))
      return nil
    }
    log.Printf("Failed to marshal signal for DC: %v", err)
  }

  // Fallback to WebSocket
  return c.websocket.Send(msg)
}

func (c *VideoChannelClient) initVideoCall() {
	// In TS this calls toggleLocalVideo(true) and sends REQUEST_JOIN_MEDIA_CHANNEL
	// Here we just send the join request when not master
	if !c.isMaster {
    m := SignalMsg{Msg: RequestJoinMediaChannel, From: c.userID, RoomId: c.roomID, Channel: getValue(ChannelWebrtc)}
    _ = c.sendSignal(m)
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
          _ = c.sendSignal(m)
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
        c.getAndClearPendingCandidates(sid)
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
  c.mu.Lock()
	for _, t := range c.localTracks {
    sender, err := pc.AddTrack(t)
    if err != nil {
      log.Printf("Failed to add track: %v", err)
      continue
    }
    // Start RTCP reader for sender (to handle PLI/NACK from server/receiver)
    go func(s *pionwebrtc.RTPSender) {
      rtcpBuf := make([]byte, 1500)
      for {
        if _, _, err := s.Read(rtcpBuf); err != nil {
          return
        }
        // If we receive PLI, we should ideally trigger a Keyframe.
        // In this simple file-loop implementation, we just continue looping.
      }
    }(sender)
	}
  c.mu.Unlock()

	pc.OnICECandidate(func(ci *pionwebrtc.ICECandidate) {
		if ci == nil {
			return
		}
		j, _ := json.Marshal(map[string]interface{}{"type": "candidate", "sdp": ci.ToJSON()})
    m := SignalMsg{Channel: getValue(ChannelWebrtc), Msg: base64.StdEncoding.EncodeToString(j), From: c.userID, To: sid, RoomId: c.roomID}
    _ = c.sendSignal(m)
	})

	pc.OnTrack(func(track *pionwebrtc.TrackRemote, receiver *pionwebrtc.RTPReceiver) {
		c.mu.Lock()
		c.streams[sid] = append(c.streams[sid], track)
		c.mu.Unlock()

    cancel := setupTrackHandlers(pc, track)
    _ = cancel // store if you need to cancel later

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
      _ = c.sendSignal(m)
		}
	}
	return nil
}

// Public Api ------------------------------------------------

// Close tears down connections and websocket
func (c *VideoChannelClient) Close() {
  if c.videoCancel != nil {
    c.videoCancel()
  }
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

// HandleSignalMsg processes a signaling message from an external source (e.g., DataChannel).
// This allows the client to handle Offer/Answer/Candidate messages that arrive via DataChannel instead of WebSocket.
func (c *VideoChannelClient) HandleSignalMsg(msg SignalMsg) {
	// We handle this in a goroutine to not block the caller (e.g. uav_api message loop)
	go func() {
		// Re-use existing logic.
		// Check for specific join request first, similar to listenSignaling
		if msg.Channel != nil && *msg.Channel == ChannelWebrtc {
			if msg.Msg == RequestJoinMediaChannel {
				_ = c.createVideoPeerConnection(msg.From, c.isMaster)
			} else {
				c.handleSignalingData(&msg)
			}
		}
	}()
}

// ToggleLocalVideo and ToggleLocalMic attempt to enable/disable local tracks
func (c *VideoChannelClient) ToggleLocalVideo(enable bool) {
  c.mu.Lock()
  defer c.mu.Unlock()

  if !enable {
    if c.videoCancel != nil {
      c.videoCancel()
      c.videoCancel = nil
    }
    return
  }

  if c.videoCancel != nil {
    // Already running
    return
  }

  // Create context for video loop
  c.videoCtx, c.videoCancel = context.WithCancel(context.Background())

  // If no local tracks, try to create one and start feeding it
  if len(c.localTracks) == 0 {
    videoTrack, err := pionwebrtc.NewTrackLocalStaticSample(pionwebrtc.RTPCodecCapability{MimeType: pionwebrtc.MimeTypeH264}, "video", "pion")
    if err != nil {
      log.Printf("Failed to create video track: %v", err)
      return
    }
    c.localTracks = append(c.localTracks, videoTrack)
    // Add to existing peers
    for _, pc := range c.peers {
      sender, err := pc.AddTrack(videoTrack)
      if err != nil {
        log.Println("AddTrack error:", err)
        continue
      }
      go func(s *pionwebrtc.RTPSender) {
        rtcpBuf := make([]byte, 1500)
        for {
          if _, _, err := s.Read(rtcpBuf); err != nil {
            return
          }
        }
      }(sender)
    }
  }

  // Start feeding the first track with file data
  go c.streamVideoLoop(c.videoCtx, c.localTracks[0])
}

func (c *VideoChannelClient) streamVideoLoop(ctx context.Context, track *pionwebrtc.TrackLocalStaticSample) {
  // Attempt to open video.h264
  fileName := "/home/assmin/YourMan.mp4"
  // Check if file exists
  if _, err := os.Stat(fileName); os.IsNotExist(err) {
    log.Printf("Video file %s not found, cannot stream", fileName)
    return
  }

  log.Printf("Starting video stream from %s", fileName)

  // Loop forever until context cancelled
  for {
    select {
    case <-ctx.Done():
      return
    default:
    }

    file, err := os.Open(fileName)
    if err != nil {
      log.Printf("Error opening video file: %v", err)
      time.Sleep(time.Second)
      continue
    }

    h264 := NewH264Reader(file)
    ticker := time.NewTicker(33 * time.Millisecond) // ~30 fps

    for {
      select {
      case <-ctx.Done():
        ticker.Stop()
        file.Close()
        return
      case <-ticker.C:
      }

      nal, err := h264.NextNAL()
      if err == io.EOF {
        break // restart file loop
      }
      if err != nil {
        log.Printf("Error reading H264: %v", err)
        break
      }

      if err := track.WriteSample(media.Sample{Data: nal, Duration: 33 * time.Millisecond}); err != nil {
        log.Printf("Error writing sample: %v", err)
        break
      }
    }
    ticker.Stop()
    file.Close()
  }
}

func (c *VideoChannelClient) ToggleLocalMic(enable bool) {
	// Placeholder: implement as needed by managing audio tracks
}

// getValue is defined in another file (data_channel.go) in this package.

func setupTrackHandlers(pc *pionwebrtc.PeerConnection, track *pionwebrtc.TrackRemote) context.CancelFunc {
  ctx, cancel := context.WithCancel(context.Background())

  // Dừng khi PeerConnection chuyển sang trạng thái kết thúc
  pc.OnConnectionStateChange(func(state pionwebrtc.PeerConnectionState) {
    if state == pionwebrtc.PeerConnectionStateClosed ||
      state == pionwebrtc.PeerConnectionStateFailed ||
      state == pionwebrtc.PeerConnectionStateDisconnected {
      cancel()
    }
  })

  // khởi tạo và chạy ngay lập tức một Goroutine (luồng nhẹ - lightweight thread) ẩn danh.
  // PLI ticker: yêu cầu keyframe định kỳ
  go func() {
    ticker := time.NewTicker(PictureLossIndication)
    defer ticker.Stop()
    for {
      select {
      case <-ctx.Done():
        return
      case <-ticker.C:
        err := pc.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(track.SSRC())}})
        if err != nil {
          log.Println("WriteRTCP(PLI) error:", err)
        }
      }
    }
  }()

  // Đọc RTP để không cho buffer đầy
  go func() {
    buf := make([]byte, MaximumTransmissionUnit)
    for {
      select {
      case <-ctx.Done():
        return
      default:
        _, _, err := track.Read(buf)
        if err != nil {
          // track closed or read error -> stop
          return
        }
      }
    }
  }()

  return cancel
}
