package routes

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"go-rest-api/config"
	api "go-rest-api/controllers"
	"go-rest-api/middlewares"
	"log"
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

	// Join room with websocket
	r.GET("/ws/join/:roomId/c/:userId", rtcApi.WebSocketConnectHandler)

	// WebSocket endpoint example
	r.GET("/ws", func(c *gin.Context) {
		websocket := config.GetWebSocket()

		// Upgrade the HTTP connection to a WebSocket connection
		conn, err := websocket.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			log.Println("Failed to upgrade connection to WebSocket:", err)
			return
		}
		defer func() {
			// Handle the error from conn.Close()
			if err := conn.Close(); err != nil {
				log.Println("Failed to close WebSocket connection:", err)
			}
		}()

		// Handle WebSocket messages (infinity for loop with blocking function `conn.ReadMessage()`)
		for {
			// Read message from the client
			messageType, message, err := conn.ReadMessage()
			if err != nil {
				log.Println("Failed to read message:", err)
				break
			}

			// Log the received message
			fmt.Printf("Received: %s\n", message)

			// Echo the message back to the client
			if err := conn.WriteMessage(messageType, message); err != nil {
				log.Println("Failed to write message:", err)
				break
			}
		}
	})
	return r
}
