package main

import (
	"crypto/sha256"
	"encoding/hex"
	jwt "github.com/appleboy/gin-jwt/v2"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
	"time"
)

type Login struct {
	Username string `form:"username" json:"username" binding:"required"`
	Password string `form:"password" json:"password" binding:"required"`
}

func hashSHA256(password string) string {
	// Chuyển chuỗi mật khẩu thành slice byte
	hash := sha256.New()
	hash.Write([]byte(password))

	// Tính toán giá trị hash và trả về kết quả dưới dạng chuỗi hex
	return hex.EncodeToString(hash.Sum(nil))
}

func configRoutes() *gin.Engine {
	r := gin.Default()
	uuidString := uuid.New().String()
	authMiddleware, err := jwt.New(&jwt.GinJWTMiddleware{
		Realm:      "example zone",
		Key:        []byte(uuidString + "eb43b856"),
		Timeout:    time.Hour,
		MaxRefresh: time.Hour,
		Authenticator: func(c *gin.Context) (interface{}, error) {
			var loginVals Login
			if err := c.ShouldBind(&loginVals); err != nil {
				return "", jwt.ErrMissingLoginValues
			}

			userID := loginVals.Username
			password := loginVals.Password
			hashPassword := hashSHA256(password)

			// Validate username/password
			user, err := service.FindByUsername(userID)
			if err != nil {
				return nil, jwt.ErrFailedAuthentication
			}
			if user.Username == "admin" && hashPassword == user.Password {
				return &Login{Username: userID}, nil
			}
			return nil, jwt.ErrFailedAuthentication
		},
		IdentityHandler: func(c *gin.Context) interface{} {
			claims := jwt.ExtractClaims(c)
			return claims["id"]
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
	return r
}

func main() {
	router := configRoutes()

	err := router.Run(":8080")
	if err != nil {
		return
	}
}
