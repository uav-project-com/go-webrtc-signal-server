package routes

import (
	"github.com/gin-gonic/gin"
	"go-rest-api/config"
	api "go-rest-api/controllers"
	"go-rest-api/middlewares"
)

func NewRoute(productApi *api.ProductController, rtcApi *api.WebRtcController) *gin.Engine {
	r := gin.Default()

	// Register the IPLogger middleware
	r.Use(middlewares.IPLogger())
	// cors bypass
	r.Use(config.CorsMiddleware())

	// Recovery middleware to handle panics
	r.Use(gin.Recovery())

	// Increase the maximum request body size to 10 MB
	r.MaxMultipartMemory = 10 << 20 // 10 MB (dịch bit)

	r.GET("/products", productApi.FindProductsHandler)
	r.POST("/products", api.CreateProduct)
	r.GET("/products/:id", api.FindProduct)
	r.PUT("/products/:id", api.UpdateProduct)
	r.DELETE("/products/:id", api.DeleteProduct)
	// webrtc
	r.POST("/webrtc/sdp/m/:meetingId/c/:userID/p/:peerID/s/:isSender", rtcApi.MakeVideoCallHandler)
	return r
}
