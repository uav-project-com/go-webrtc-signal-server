package routes

import (
	"github.com/gin-gonic/gin"
	"go-rest-api/config"
	api "go-rest-api/controllers"
	"go-rest-api/middlewares"
)

func NewRoute(rtcApi *api.WebRtcController) *gin.Engine {
	r := gin.Default()

	// Register the IPLogger middleware
	r.Use(middlewares.IPLogger())
	// cors bypass
	r.Use(config.CorsMiddleware())

	// Recovery middleware to handle panics
	r.Use(gin.Recovery())

	// Increase the maximum request body size to 10 MB
	r.MaxMultipartMemory = 10 << 20 // 10 MB (dịch bit)

	// webrtc client control
	r.POST("/remote/:roomId", rtcApi.MakeVideoCallHandler)
	return r
}
