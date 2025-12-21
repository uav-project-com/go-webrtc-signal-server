//go:build dev

package main

import (
	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/api"
)

func RegisterE2eRoutes(r *gin.Engine, authMiddleware *jwt.GinJWTMiddleware, uavHandler api.UavAPI) {
	auth := r.Group("/e2e")
	auth.Use(authMiddleware.MiddlewareFunc())
	auth.POST("/start", func(c *gin.Context) { uavHandler.StartUavControlHandler(c) })
	auth.POST("/command", func(c *gin.Context) { uavHandler.CommandHandler(c) })
}
