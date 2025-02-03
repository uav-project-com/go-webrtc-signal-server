package routes

import (
	"go-rest-api/config"
	api "go-rest-api/controllers"
	"go-rest-api/middlewares"

	"github.com/gin-gonic/gin"
)

func NewRoute(productApi *api.ProductController, rtcApi *api.WebRtcController) *gin.Engine {
	r := gin.Default()

	// Register the IPLogger middleware
	r.Use(middlewares.IPLogger())
	// cors bypass
	r.Use(config.CorsMiddleware())

	r.GET("/products", productApi.FindProductsHandler)
	r.POST("/products", api.CreateProduct)
	r.GET("/products/:id", api.FindProduct)
	r.PUT("/products/:id", api.UpdateProduct)
	r.DELETE("/products/:id", api.DeleteProduct)
	// webrtc
	r.POST("/webrtc/sdp/m/:meetingId/c/:userID/p/:peerID/s/:isSender", rtcApi.MakeVideoCallHandler)
	return r
}
