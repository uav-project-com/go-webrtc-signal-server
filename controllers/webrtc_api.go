package controllers

import (
	"github.com/gin-gonic/gin"
	"go-rest-api/dto"
	"go-rest-api/service"
	"strconv"
)

type WebRtcController struct {
	Controller
	videoCallService service.VideoCallService
}

func NewWebRtcController(svc service.VideoCallService) *WebRtcController {
	return &WebRtcController{videoCallService: svc}
}

func (c *WebRtcController) MakeVideoCallHandler(ctx *gin.Context) {
	isSender, _ := strconv.ParseBool(ctx.Param("isSender"))
	info := dto.PeerInfo{
		MeetingID: "",
		UserId:    ctx.Param("userID"),
		PeerId:    ctx.Param("peerID"),
		IsSender:  isSender,
	}
	c.videoCallService.CallBroadcast(ctx, info)
}
