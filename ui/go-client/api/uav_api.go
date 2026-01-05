// Package api Common uavAPI implementation (struct and shared methods)
package api

import (
  "encoding/json"
  "github.com/gin-gonic/gin"
  "github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
  "github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/webrtc"
  "log"
)

type uavAPI struct {
	Api
  databaseSvc  service.DatabaseProviderService
  socketSvc    service.SocketService
  userSvc      service.UserService
  dataChannel  *webrtc.DataChannelClient
  videoChannel *webrtc.VideoChannelClient
  videoEnabled bool
  audioEnabled bool
  channelInfo  *service.ChannelInfo
}

func (a *uavAPI) UavCommandHandler(cmd string) error {
	// 1. Try to parse as JSON SignalMsg (from Angular DataChannel signaling)
	var msg webrtc.SignalMsg
	if err := json.Unmarshal([]byte(cmd), &msg); err == nil {
		// Is this a video signaling message?
		isVideoSignal := (msg.Msg == webrtc.RequestJoinMediaChannel) ||
			(msg.Channel != nil && *msg.Channel == webrtc.ChannelWebrtc)

		if isVideoSignal {
			log.Println("Received Video Signaling via DataChannel. Forwarding to VideoChannelClient...")

			// Ensure VideoChannel is initialized
			if a.videoChannel == nil {
				log.Println("Initializing VideoChannelClient on demand...")
				var errInit error
				a.videoChannel, errInit = a.socketSvc.InitVideoChannel(a.channelInfo)
				if errInit != nil {
					return errInit
				}
			}

			// Forward the message to VideoChannelClient
			a.videoChannel.HandleSignalMsg(msg)

			// Special case: If it's a join request, we might want to auto-start sending video?
			// The original logic toggled video on CmdVideoToggle.
			// Angular sends RequestJoinMediaChannel when user clicks "Camera".
			// So we should probably enable our video sending too.
			if msg.Msg == webrtc.RequestJoinMediaChannel {
				if !a.videoEnabled {
					log.Println("Auto-enabling local video stream due to Join Request.")
					a.videoEnabled = true
					a.videoChannel.ToggleLocalVideo(true)
				}
			}
			return nil
		}
	}

	// 2. Handle legacy/plain text commands
	log.Printf("Processing plain command: %s", cmd)
	if cmd == CmdVideoToggle { // start or stop video stream
		a.videoEnabled = !a.videoEnabled
		if a.videoEnabled {
			if a.videoChannel == nil {
				var err error
				a.videoChannel, err = a.socketSvc.InitVideoChannel(a.channelInfo)
				if err != nil {
					return err
				}
			}
		}
		if a.videoChannel != nil {
			a.videoChannel.ToggleLocalVideo(a.videoEnabled)
		}
	}
	return nil
}

func NewUavAPI(dps service.DatabaseProviderService, ss service.SocketService, us service.UserService) UavAPI {
	return &uavAPI{databaseSvc: dps, socketSvc: ss, userSvc: us}
}

func (a *uavAPI) StartUavControlHandler(ctx *gin.Context) {
	user, err := a.userSvc.ExtractToken(ctx.GetHeader("Authorization"))
	if err != nil {
		ctx.AbortWithStatusJSON(401, gin.H{"error": "unauthorized", "reason": "invalid credentials"})
		return
	}
	// init & join websocket to server for signaling exchange
	webSocket, e := a.socketSvc.InitWebSocketKeepConnection(ctx.Request.Context(), &user.Username)
	if e != nil {
		log.Fatal("InitWebSocketKeepConnection:", e)
	}
	master := ctx.Query("isMaster")
	isMaster := webrtc.IsReceiver
	if master == "true" || master == "false" {
		log.Printf("E2E test, master is %s", master)
		isMaster = master == "true"
	}
  channelInfo := &service.ChannelInfo{
		Sid:      &user.Username,
		RoomId:   &webSocket.Config.Room,
		IsMaster: &isMaster,
		WsClient: webSocket.WsClient,
	}
  a.channelInfo = channelInfo
	dataChannel, err := a.socketSvc.InitDataChannel(channelInfo)
	if err != nil {
		log.Fatal("InitDataChannel:", err)
	}
	// keep reference for command handler
	a.dataChannel = dataChannel
  log.Println("Registering OnMessage listener")
	dataChannel.AddOnMessageEventListener(func(message string) {
    log.Printf("Callback triggered with message: %s", message)
    err := a.UavCommandHandler(message)
    if err != nil {
      log.Println("UavCommandHandler:", err)
    }
	})
}
