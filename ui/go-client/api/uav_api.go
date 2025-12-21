package api

import (
	"log"

	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/webrtc"

	"github.com/gin-gonic/gin"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
)

type UavAPI interface {
	StartUavControlHandler(ctx *gin.Context)
	CommandHandler(ctx *gin.Context)
}

type uavAPI struct {
	Api
	databaseSvc service.DatabaseProviderService
	socketSvc   service.SocketService
	userSvc     service.UserService
	dataChannel *webrtc.DataChannelClient
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
	channelInfo := &service.DataChannel{
		Sid:      &user.Username,
		RoomId:   &webSocket.Config.Room,
		IsMaster: &isMaster,
		WsClient: webSocket.WsClient,
	}
	dataChannel, err := a.socketSvc.InitDataChannel(channelInfo)
	if err != nil {
		log.Fatal("InitDataChannel:", err)
	}
	// keep reference for command handler
	a.dataChannel = dataChannel
	dataChannel.AddOnMessageEventListener(func(message string) {
		log.Printf("Received message from Sender: %s\n", message)
	})
}

// CommandHandler receives a JSON body {"message": "..."} and sends it over the data channel.
func (a *uavAPI) CommandHandler(ctx *gin.Context) {
	var req struct {
		Message string `json:"message"`
	}
	if err := ctx.ShouldBindJSON(&req); err != nil {
		ctx.JSON(400, gin.H{"error": "invalid request", "reason": err.Error()})
		return
	}
	if a.dataChannel == nil {
		ctx.JSON(500, gin.H{"error": "datachannel not initialized"})
		return
	}
	a.dataChannel.SendMsg(req.Message)
	ctx.JSON(200, gin.H{"status": "sent"})
}
