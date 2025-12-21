//go:build !dev

package main

import (
	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/api"
)

// RegisterE2eRoutes is a no-op in non-dev builds to satisfy references
func RegisterE2eRoutes(_ *gin.Engine, _ *jwt.GinJWTMiddleware, _ api.UavAPI) {
	// intentionally left blank for non-dev builds
}
