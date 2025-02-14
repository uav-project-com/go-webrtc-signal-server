package service

import (
	"errors"
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v4"
	"go-rest-api/config"
	"go-rest-api/dto"
	"go-rest-api/utils"
	"io"
	"log"
	"time"
)

const (
	rtcpPLIInterval = time.Second * 3
)

type VideoCallService interface {
	CallBroadcast(*gin.Context, dto.PeerInfo) (config.Sdp, error)
}

type videoCallService struct {
}

func (v *videoCallService) CallBroadcast(c *gin.Context, callInfo dto.PeerInfo) (config.Sdp, error) {
	var session config.Sdp // body => into new api is body's session field
	if err := c.ShouldBindJSON(&session); err != nil {
		log.Println("ShouldBindJSON", err)
		return config.Sdp{}, err
	}

	offer := webrtc.SessionDescription{}
	utils.Decode(session.Sdp, &offer)

	// Create a new RTCPeerConnection
	// this is the gist of webrtc, generates and process SDP
	println("peerConnection - new")
	peerConnection, err := config.AppConfig.Api.NewPeerConnection(*config.AppConfig.IceConfig)

	if err != nil {
		log.Println("NewPeerConnection error occurred", err)
	}
	if !callInfo.IsSender {
		err = receiveTrack(peerConnection, config.AppConfig.PeerConnectionMapLocal, callInfo.PeerId)
	} else {
		err = createTrack(peerConnection, config.AppConfig.PeerConnectionMapLocal, callInfo.UserId)
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
