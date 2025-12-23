//go:build dev

package api

import "github.com/gin-gonic/gin"

type UavAPI interface {
	StartUavControlHandler(ctx *gin.Context)
	CommandHandler(ctx *gin.Context)
  UavCommandHandler(cmd string) error
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
