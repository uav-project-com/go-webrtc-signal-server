package main

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"time"

	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	_ "github.com/mattn/go-sqlite3"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/api"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
)

type Login struct {
	Username string `form:"username" json:"username" binding:"required"`
	Password string `form:"password" json:"password" binding:"required"`
	ID       int64  `json:"id,omitempty"`
}

func hashSHA256(password string) string {
	hash := sha256.New()
	hash.Write([]byte(password))
	return hex.EncodeToString(hash.Sum(nil))
}

func configRoutes(service service.UserService, uavHandler api.UavAPI) *gin.Engine {
	r := gin.Default()
	uuidString := uuid.New().String()
	authMiddleware, err := jwt.New(&jwt.GinJWTMiddleware{
		Realm:      "example zone",
		Key:        []byte(uuidString + "eb43b856"),
		Timeout:    3 * time.Hour,
		MaxRefresh: 6 * time.Hour,
		PayloadFunc: func(data interface{}) jwt.MapClaims {
			if v, ok := data.(*Login); ok {
				return jwt.MapClaims{"uid": v.Username, "sub": fmt.Sprintf("%d", v.ID)}
			}
			return jwt.MapClaims{}
		},
		Authenticator: func(c *gin.Context) (interface{}, error) {
			var loginVals Login
			if err := c.ShouldBind(&loginVals); err != nil {
				return "", jwt.ErrMissingLoginValues
			}

			userID := loginVals.Username
			password := loginVals.Password
			hashPassword := hashSHA256(password)

			user, err := service.FindByUsername(c.Request.Context(), userID)
			if err != nil {
				log.Printf("FindByUsername error: %v\n", err)
				c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized", "reason": "service lookup failed"})
				return nil, jwt.ErrFailedAuthentication
			}
			if user.Username == userID && hashPassword == user.Password {
				return &Login{Username: userID, ID: user.ID}, nil
			}
			c.AbortWithStatusJSON(401, gin.H{"error": "unauthorized", "reason": "invalid credentials"})
			return nil, jwt.ErrFailedAuthentication
		},
		IdentityHandler: func(c *gin.Context) interface{} {
			claims := jwt.ExtractClaims(c)
			return claims["uid"]
		},
	})

	if err != nil {
		panic(err)
	}

	r.POST("/login", authMiddleware.LoginHandler)
	r.GET("/refresh", authMiddleware.RefreshHandler)

	auth := r.Group("/auth")
	auth.Use(authMiddleware.MiddlewareFunc())
	auth.GET("/hello", func(c *gin.Context) {
		c.JSON(200, gin.H{"message": "Hello from protected route"})
	})

	auth = r.Group("/uav")
	auth.Use(authMiddleware.MiddlewareFunc())
	auth.POST("/start", func(c *gin.Context) {
		uavHandler.StartUavControlHandler(c)
	})

	// register e2e routes; concrete implementation provided by dev/non-dev files
	RegisterE2eRoutes(r, authMiddleware, uavHandler)
	return r
}

var db *sql.DB

func initDB() (*sql.DB, error) {
	var err error
	db, err = sql.Open("sqlite3", "/media/hieutt/Data/workspace/0.FPV/go-webrtc-signal-server/ui/go-client/SQLite.db")
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping sqlite db: %w", err)
	}
	return db, nil
}

func closeDB() {
	if err := db.Close(); err != nil {
		log.Printf("Error closing DB: %v", err)
	}
}
