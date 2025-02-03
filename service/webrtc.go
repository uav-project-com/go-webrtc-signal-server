package service

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/pion/rtcp"
	"github.com/pion/webrtc/v2"
	"go-rest-api/config"
	"go-rest-api/dto"
	"go-rest-api/utils"
	"io"
	"log"
	"net/http"
	"time"
)

const (
	rtcpPLIInterval = time.Second * 3
)

type VideoCallService interface {
	CallBroadCast(*gin.Context, dto.PeerInfo)
}

type videoCallService struct {
}

func (v *videoCallService) CallBroadCast(c *gin.Context, callInfo dto.PeerInfo) {
	var session config.Sdp // body => into new api is body's session field
	if err := c.ShouldBindJSON(&session); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	offer := webrtc.SessionDescription{}
	utils.Decode(session.Sdp, &offer)

	// Create a new RTCPeerConnection
	// this is the gist of webrtc, generates and process SDP
	peerConnection, err := config.AppConfig.Api.NewPeerConnection(*config.AppConfig.IceConfig)
	println("peerConnection - new")
	if err != nil {
		log.Fatal(err)
	}
	if !callInfo.IsSender {
		receiveTrack(peerConnection, config.AppConfig.PeerConnectionMap, callInfo.PeerId)
	} else {
		createTrack(peerConnection, config.AppConfig.PeerConnectionMap, callInfo.UserId)
	}
	// Set the SessionDescription of remote callInfo
	err = peerConnection.SetRemoteDescription(offer)
	if err != nil {
		log.Fatal(err)
	}

	// Create answer
	answer, err := peerConnection.CreateAnswer(nil)
	if err != nil {
		log.Fatal(err)
	}

	// Sets the LocalDescription, and starts our UDP listeners
	err = peerConnection.SetLocalDescription(answer)
	if err != nil {
		log.Fatal(err)
	}
	c.JSON(http.StatusOK, config.Sdp{Sdp: utils.Encode(answer)})
}

func NewVideoCallService() VideoCallService {
	return &videoCallService{}
}

// user is the caller of the method
// if user connects before peer: create channel and keep listening till track is added
// if peer connects before user: channel would have been created by peer and track can be added by getting the channel from cache
func receiveTrack(peerConnection *webrtc.PeerConnection,
	peerConnectionMap map[string]chan *webrtc.Track,
	peerID string) {
	if _, ok := peerConnectionMap[peerID]; !ok {
		peerConnectionMap[peerID] = make(chan *webrtc.Track, 1)
	}
	localTrack := <-peerConnectionMap[peerID]
	peerConnection.AddTrack(localTrack)
}

// user is the caller of the method
// if user connects before peer: since user is first, user will create the channel and track and will pass the track to the channel
// if peer connects before user: since peer came already, he created the channel and is listning and waiting for me to create and pass track
func createTrack(peerConnection *webrtc.PeerConnection,
	peerConnectionMap map[string]chan *webrtc.Track,
	currentUserID string) {

	if _, err := peerConnection.AddTransceiver(webrtc.RTPCodecTypeVideo); err != nil {
		log.Fatal(err)
	}

	// Set a handler for when a new remote track starts, this just distributes all our packets
	// to connected peers
	peerConnection.OnTrack(func(remoteTrack *webrtc.Track, receiver *webrtc.RTPReceiver) {
		// Send a PLI on an interval so that the publisher is pushing a keyframe every rtcpPLIInterval
		// This can be less wasteful by processing incoming RTCP events, then we would emit a NACK/PLI when a viewer requests it
		//Trong đoạn code có gợi ý rằng việc gửi PLI định kỳ có thể "lãng phí tài nguyên".
		//	Một cách tối ưu hơn là lắng nghe các sự kiện RTCP từ người xem (viewers),
		//	chỉ gửi PLI khi cần thiết (ví dụ, khi nhận được yêu cầu NACK hoặc PLI từ phía người xem).
		//	Điều này giúp tiết kiệm băng thông và tài nguyên xử lý.
		go func() {
			ticker := time.NewTicker(rtcpPLIInterval)
			for range ticker.C {
				if rtcpSendErr := peerConnection.WriteRTCP([]rtcp.Packet{&rtcp.PictureLossIndication{MediaSSRC: remoteTrack.SSRC()}}); rtcpSendErr != nil {
					fmt.Println(rtcpSendErr)
				}
			}
		}()

		// Create a local track, all our SFU clients will be fed via this track
		// main track of the broadcaster
		localTrack, newTrackErr := peerConnection.NewTrack(remoteTrack.PayloadType(), remoteTrack.SSRC(), "video", "pion")
		if newTrackErr != nil {
			log.Fatal(newTrackErr)
		}

		// the channel that will have the local track that is used by the sender
		// the localTrack needs to be fed to the reciever
		localTrackChan := make(chan *webrtc.Track, 1)
		localTrackChan <- localTrack
		if existingChan, ok := peerConnectionMap[currentUserID]; ok {
			// feed the exsiting track from user with this track
			existingChan <- localTrack
		} else {
			peerConnectionMap[currentUserID] = localTrackChan
		}

		rtpBuf := make([]byte, 1400)
		for { // for publisher only
			i, readErr := remoteTrack.Read(rtpBuf)
			if readErr != nil {
				log.Fatal(readErr)
			}

			// ErrClosedPipe means we don't have any subscribers, this is ok if no peers have connected yet
			if _, err := localTrack.Write(rtpBuf[:i]); err != nil && err != io.ErrClosedPipe {
				log.Fatal(err)
			}
		}
	})

}
