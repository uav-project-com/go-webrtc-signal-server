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
  // 1. Thử parse lệnh JSON (Từ Angular DataChannel) TODO: chưa test....
  var data map[string]interface{}
  if err := json.Unmarshal([]byte(cmd), &data); err == nil {
    // Xử lý lệnh điều khiển Camera chuyên sâu
    if action, ok := data["action"].(string); ok && action == ActionCamera {
      camCmd, _ := data["cmd"].(string)
      val, _ := data["val"].(float64)
      camManager := webrtc.GetCameraManager()

      log.Printf("Camera Control: Lệnh %s với giá trị %v", camCmd, val)
      switch camCmd {
      case CmdCameraZoom:
        camManager.SetZoom(val)
      case CmdCameraFocus:
        camManager.SetFocus(int(val))
      case CmdCameraSwitch:
        camManager.SwitchCamera(int(val))
      case CmdCameraReset:
        err := camManager.Restart()
        if err != nil {
          return err
        }
      case CmdCameraISO:
        camManager.SetISO(int(val))
      }
      return nil
    }

    // Xử lý signaling WebRTC (logic cũ)
    var msg webrtc.SignalMsg
    _ = json.Unmarshal([]byte(cmd), &msg)
		isVideoSignal := (msg.Msg == webrtc.RequestJoinMediaChannel) ||
			(msg.Channel != nil && *msg.Channel == webrtc.ChannelWebrtc)

		if isVideoSignal {
      log.Println("Nhận tín hiệu Video qua DataChannel. Đang chuyển tiếp...")
			if a.videoChannel == nil {
				var errInit error
				a.videoChannel, errInit = a.socketSvc.InitVideoChannel(a.channelInfo)
				if errInit != nil {
					return errInit
				}
			}
			a.videoChannel.HandleSignalMsg(msg)
      if msg.Msg == webrtc.RequestJoinMediaChannel && !a.videoEnabled {
        a.videoEnabled = true
        a.videoChannel.ToggleLocalVideo(true)
			}
			return nil
		}
	}

  // 2. Xử lý các lệnh văn bản thuần túy (Legacy) TODO: chưa test....
  log.Printf("Xử lý lệnh văn bản: %s", cmd)
  if cmd == CmdVideoToggle {
		a.videoEnabled = !a.videoEnabled
    if a.videoEnabled && a.videoChannel == nil {
      var err error
      a.videoChannel, err = a.socketSvc.InitVideoChannel(a.channelInfo)
      if err != nil {
        return err
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
