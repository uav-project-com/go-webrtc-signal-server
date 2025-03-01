package service

import (
	"encoding/base64"
	"encoding/json"
	"fmt"
	"github.com/davecgh/go-spew/spew"
	"go-rest-api/config"
	"go-rest-api/dto"
	"go-rest-api/utils"
	"io"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"github.com/pkg/errors"
)

const (
	rtcpPLIInterval = time.Second * 3
)

type VideoCallService interface {
	CallBroadcast(*gin.Context, dto.PeerInfo) (config.Sdp, error)
	JoinRoom(*gin.Context, dto.JoinRequest) error
}

type videoCallService struct {
}

func (v *videoCallService) JoinRoom(ctx *gin.Context, req dto.JoinRequest) error {
	ws := config.AppConfig.WebSock.Upgrade
	mutex := config.AppConfig.WebSock.Mutex
	rooms := config.AppConfig.WebSock.RoomLst

	// Upgrade the HTTP connection to a WebSocket connection
	conn, err := ws.Upgrade(ctx.Writer, ctx.Request, nil)
	if err != nil {
		log.Println("Failed to upgrade connection to WebSocket:", err)
		return errors.Wrap(err, "Failed to upgrade connection to WebSocket")
	}
	defer func() {
		// Handle the error from conn.Close()
		if err := conn.Close(); err != nil {
			log.Println("Failed to close WebSocket connection:", err)
		}
	}()
	// Thêm user vào room - locking resource
	mutex.Lock()
	if _, exists := rooms[req.RoomID]; !exists {
		// create new room!
		rooms[req.RoomID] = make(map[string]*websocket.Conn)
	} else {
		// validate user joined in this roomID
		if _, exists := rooms[req.RoomID][req.UserID]; exists {
			// TODO: enable re-join to room
			// return errors.New(fmt.Sprintf("User %s already joined", req.UserID))
			log.Println("Warning Re-join room:", req.RoomID, req.UserID)
		}
	}
	// mapping UserID to new Room
	rooms[req.RoomID][req.UserID] = conn
	// echo connected event to user in the first time
	wsResponse(nil, conn, dto.WsResponse{
		Status:  http.StatusOK,
		Message: "onConnected-" + fmt.Sprint(len(rooms[req.RoomID])),
	})
	mutex.Unlock() // unlock resource
	log.Printf("[%s] %s joined room %s\n", req.RoomID, req.UserID, req.RoomID)
	defer func() {
		// Xóa user khi mất kết nối
		mutex.Lock()
		delete(rooms[req.RoomID], req.UserID)
		if len(rooms[req.RoomID]) == 0 {
			delete(rooms, req.RoomID) // Xóa phòng nếu không còn user
		}
		mutex.Unlock()

		err := conn.Close()
		if err != nil {
			log.Println("Failed to close WebSocket connection:", err)
			return
		}
		log.Printf("[%s] %s left room %s\n", req.RoomID, req.UserID, req.RoomID)
	}()
	// Lắng nghe tin nhắn
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			log.Println("Read error:", err)
			break
		}

		// Giải mã JSON
		var msg dto.Message
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("Invalid JSON: %s %v", message, err)
			continue
		} else {
			log.Printf("Received: %v", spew.Sdump(msg, dto.Message{}))
			data, err := base64.StdEncoding.DecodeString(msg.Msg)
			if err != nil {
				log.Println("error:", err)
			}
			log.Printf("Content: %v", string(data))
		}
		// Send message to other
		err = sendMsg(msg, conn, msg.To == nil)
		if err != nil {
			log.Println("Send msg error:", err)
		}
	}
	return nil
}

func (v *videoCallService) CallBroadcast(c *gin.Context, callInfo dto.PeerInfo) (config.Sdp, error) {
	var session config.Sdp // body => into new api is body's session field
	if err := c.ShouldBindJSON(&session); err != nil {
		log.Println("ShouldBindJSON", err)
		return config.Sdp{}, err
	}

	offer := webrtc.SessionDescription{}
	utils.Decode(session.Sdp, &offer)
	spew.Dump(offer)

	// Create a new RTCPeerConnection
	// this is the gist of webrtc, generates and process SDP
	println("peerConnection - new")
	peerConnection, err := config.AppConfig.Api.NewPeerConnection(*config.AppConfig.IceConfig)

	if err != nil {
		log.Println("NewPeerConnection error occurred", err)
	}

	//dataChanel, err := peerConnection.CreateDataChannel("remote", &webrtc.DataChannelInit{
	//	Ordered:           utils.AsPointer(false),       // message ordering
	//	MaxPacketLifeTime: utils.AsPointer(uint16(100)), // keep package in 100 mini second and then discard
	//	Negotiated:        utils.AsPointer(false),       // auto create ID for data chanel
	//})
	//if err != nil {
	//	log.Println("CreateDataChannel error occurred", err)
	//}
	//dataChanel.OnOpen(func() {
	//	log.Println("OnOpen")
	//})
	//dataChanel.OnMessage(func(msg webrtc.DataChannelMessage) {
	//	log.Println("OnMessage", msg.Data)
	//	err := dataChanel.SendText(string(msg.Data))
	//	if err != nil {
	//		log.Println("SendText error occurred", err)
	//	}
	//})

	if !callInfo.IsSender {
		err = receiveTrack(peerConnection, config.AppConfig.PeerConnectionMap, callInfo.PeerId)
	} else {
		err = createTrack(peerConnection, config.AppConfig.PeerConnectionMap, callInfo.UserId)
	}
	if err != nil {
		log.Println("onTrack error", err)
		return config.Sdp{}, err
	}

	// Set the SessionDescription of remote callInfo
	err = peerConnection.SetRemoteDescription(offer)
	if err != nil {
		log.Println("error occurred", err)
		return config.Sdp{}, err
	}

	// Create answer
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		log.Println("error occurred", err)
	}

	// Sets the LocalDescription, and starts our UDP listeners
	err = peerConnection.SetLocalDescription(answer)
	if err != nil {
		log.Println("error occurred", err)
		return config.Sdp{}, err
	}
	return config.Sdp{Sdp: utils.Encode(answer)}, nil
}

func NewVideoCallService() VideoCallService {
	return &videoCallService{}
}

// user is the caller of the method
// if user connects before peer: create channel and keep listening till track is added
// if peer connects before user: channel would have been created by peer and track can be added by getting the channel from cache
func receiveTrack(peerConnection *webrtc.PeerConnection,
	peerConnectionMap map[string]chan *webrtc.TrackLocalStaticRTP,
	peerID string) error {
	if _, ok := peerConnectionMap[peerID]; !ok {
		peerConnectionMap[peerID] = make(chan *webrtc.TrackLocalStaticRTP, 1)
	}
	localTrack := <-peerConnectionMap[peerID]
	_, err := peerConnection.AddTrack(localTrack)
	if err != nil {
		log.Println("Error adding track", err)
		return err
	}
	return nil
}

// user is the caller of the method
// if user connects before peer: since user is first, user will create the channel and track and will pass the track to the channel
// if peer connects before user: since peer came already, he created the channel and is listning and waiting for me to create and pass track
func createTrack(peerConnection *webrtc.PeerConnection, pcMapLocal map[string]chan *webrtc.TrackLocalStaticRTP, currentUserID string) error {

	if _, err := peerConnection.AddTransceiverFromKind(webrtc.RTPCodecTypeVideo); err != nil {
		log.Println("Error occurred", err)
		return err
	}
	var ticker *time.Ticker
	// Set a handler for when a new remote track starts, this just distributes all our packets
	// to connected peers
	peerConnection.OnTrack(func(remoteTrack *webrtc.TrackRemote, receiver *webrtc.RTPReceiver) {
		// Send a PLI on an interval so that the publisher is pushing a keyframe every rtcpPLIInterval
		// This can be less wasteful by processing incoming RTCP events, then we would emit a NACK/PLI when a viewer requests it
		//Trong đoạn code có gợi ý rằng việc gửi PLI định kỳ có thể "lãng phí tài nguyên".
		//	Một cách tối ưu hơn là lắng nghe các sự kiện RTCP từ người xem (viewers),
		//	chỉ gửi PLI khi cần thiết (ví dụ, khi nhận được yêu cầu NACK hoặc PLI từ phía người xem).
		//	Điều này giúp tiết kiệm băng thông và tài nguyên xử lý.
		go func() {
			ticker = time.NewTicker(rtcpPLIInterval)
			for range ticker.C {
				if rtcpSendErr := peerConnection.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: uint32(remoteTrack.SSRC())}}); rtcpSendErr != nil {
					fmt.Println(rtcpSendErr)
				}
			}
		}()

		// Create a local track, all our SFU clients will be fed via this track
		// main track of the broadcaster
		localTrack, newTrackErr := webrtc.NewTrackLocalStaticRTP(
			remoteTrack.Codec().RTPCodecCapability, // Use the codec from the remote track
			"video",                                // Track ID
			"pion",                                 // Stream ID
		)
		if newTrackErr != nil {
			log.Println("Error occurred", newTrackErr)
			return
		}

		// the channel that will have the local track that is used by the sender
		// the localTrack needs to be fed to the receiver
		localTrackChan := make(chan *webrtc.TrackLocalStaticRTP, 1)
		localTrackChan <- localTrack
		if existingChan, ok := pcMapLocal[currentUserID]; ok {
			// feed the existing track from user with this track
			existingChan <- localTrack
		} else {
			pcMapLocal[currentUserID] = localTrackChan
		}

		rtpBuf := make([]byte, 1400)
		for { // for publisher only
			i, _, readErr := remoteTrack.Read(rtpBuf)
			if readErr != nil {
				log.Println("Error occurred", readErr)
				return // TODO maybe break instead of return?
			}

			// ErrClosedPipe means we don't have any subscribers, this is ok if no peers have connected yet
			if _, err := localTrack.Write(rtpBuf[:i]); err != nil && !errors.Is(err, io.ErrClosedPipe) {
				log.Println("Error occurred", err)
				return // TODO maybe break instead of return?
			}
		}
	})
	peerConnection.OnConnectionStateChange(func(state webrtc.PeerConnectionState) {
		// TODO: improve stop ticker khi tất cả user out?
		log.Println("Connection state changed:", state)
		if state == webrtc.PeerConnectionStateClosed ||
			state == webrtc.PeerConnectionStateDisconnected ||
			state == webrtc.PeerConnectionStateFailed {
			log.Println("Stopping RTCP PLI sender due to disconnection")
			if ticker != nil {
				ticker.Stop() // Stop the PLI sender
			}
		}
	})
	return nil
}

// Gửi tin nhắn đến tất cả user trong phòng
func sendMsg(msg dto.Message, senderConn *websocket.Conn, broadcast bool) error {
	var conf = *config.AppConfig.WebSock
	conf.Mutex.Lock()
	connections, exists := conf.RoomLst[msg.RoomID]
	conf.Mutex.Unlock()

	if !exists {
		log.Printf("Room %s not found\n", msg.RoomID)
		return errors.New(fmt.Sprintf("Room %s not found", msg.RoomID))
	}

	// Mã hóa tin nhắn thành JSON
	data, err := json.Marshal(msg)
	if err != nil {
		log.Println("JSON encoding error:", err)
		return errors.New(fmt.Sprintf("JSON encoding error: %s", err))
	}
	// TODO for test
	broadcast = true
	if broadcast {
		// Gửi tin nhắn đến tất cả user trong phòng (trừ chính người gửi)
		for user, conn := range connections {
			if msg.From != nil && user != *msg.From {
				conf.Mutex.Lock()
				err := conn.WriteMessage(websocket.TextMessage, data)
				conf.Mutex.Unlock()
				if err != nil {
					log.Printf("Failed to send message to %s: %v\n", user, err)
				}
			}
		}
		wsResponse(nil, senderConn, dto.WsResponse{
			Status:  http.StatusOK,
			Message: "Send broadcast msg successfully",
		})
	} else {
		sent := false
		// send to exactly userID
		for user, conn := range connections {
			if msg.From != nil && user == *msg.To {
				conf.Mutex.Lock()
				err := conn.WriteMessage(websocket.TextMessage, data)
				conf.Mutex.Unlock()
				if err != nil {
					log.Printf("Failed to send message to %s: %v\n", user, err)
				} else {
					sent = true
				}
				break
			}
		}
		if !sent {
			log.Printf("Failed to send message to %s\n", *msg.To)
			wsResponse(nil, senderConn, dto.WsResponse{
				Status:  http.StatusInternalServerError,
				Message: fmt.Sprintf("Failed to send message to %s", *msg.To),
			})
			return errors.New(fmt.Sprintf("Failed to send message to %s", *msg.To))
		}
		wsResponse(conf.Mutex, senderConn, dto.WsResponse{
			Status:  http.StatusOK,
			Message: fmt.Sprintf("Sent to %s", *msg.To),
		})
	}

	return nil
}

func wsResponse(mutex *sync.Mutex, conn *websocket.Conn, resp dto.WsResponse) {
	resp.Time = time.Now().Unix()
	data, err := json.Marshal(resp)
	if err != nil {
		log.Println("Failed to encode response:", err)
		return
	}

	if conn != nil {
		if mutex != nil {
			mutex.Lock()
			defer mutex.Unlock()
		}
		err := conn.WriteMessage(websocket.TextMessage, data)
		if err != nil {
			log.Println("Failed to send response:", err)
		}
	}
}
