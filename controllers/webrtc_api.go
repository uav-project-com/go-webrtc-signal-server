package controllers

import (
	"github.com/gin-gonic/gin"
	"go-rest-api/dto"
	"go-rest-api/service"
	"log"
	"net/http"
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
	// Detect client disconnection early
	context := ctx.Request.Context()
	if err := context.Err(); err != nil {
		log.Println("Client disconnected before processing started:", err)
		return
	}
	isSender, _ := strconv.ParseBool(ctx.Param("isSender"))
	info := dto.PeerInfo{
		MeetingID: "",
		UserId:    ctx.Param("userID"),
		PeerId:    ctx.Param("peerID"),
		IsSender:  isSender,
	}
	res, err := c.videoCallService.CallBroadcast(ctx, info)
	// Monitor disconnection in a separate goroutine
	go func() {
		<-context.Done()
		log.Println("Client closed the connection mid-request")
	}()

	// Only send JSON if the client is still connected
	if context.Err() == nil {
		if err != nil {
			ctx.JSON(http.StatusBadRequest, res)
		} else {
			ctx.JSON(http.StatusOK, res)
		}
	} else {
		log.Println("Skipped response because client disconnected")
	}
}
