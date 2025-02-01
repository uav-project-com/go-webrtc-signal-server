package routes

import (
	api "go-rest-api/controllers"
	"go-rest-api/middlewares"

	"github.com/gin-gonic/gin"
)

func NewRoute(productApi *api.ProductController) *gin.Engine {
	r := gin.Default()

	// Register the IPLogger middleware
	r.Use(middlewares.IPLogger())

	r.GET("/products", productApi.FindProducts)
	r.POST("/products", api.CreateProduct)
	r.GET("/products/:id", api.FindProduct)
	r.PUT("/products/:id", api.UpdateProduct)
	r.DELETE("/products/:id", api.DeleteProduct)
	// webrtc
	r.POST("/webrtc/sdp/m/:meetingId/c/:userID/p/:peerId/s/:isSender")
	return r
}
