package config

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"log"
	"os"
	"strings"

	"github.com/joho/godotenv"
	"github.com/pion/webrtc/v2"
)

func CorsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

type Config struct {
	DBUser            string
	DBPassword        string
	DBName            string
	DBHost            string
	DBPort            string
	PeerConnectionMap map[string]chan *webrtc.Track
	Api               *webrtc.API
	IceConfig         *webrtc.Configuration
}

type Sdp struct {
	Sdp string
}

var AppConfig *Config

func LoadConfig() {
	// Load environment variables from .env file
	err := godotenv.Load()
	if err != nil {
		fmt.Println("Error loading .env file")
	}

	media := webrtc.MediaEngine{}

	// Set up the codecs you want to use.
	// Only support VP8(video compression), this makes our proxying code simpler
	media.RegisterCodec(webrtc.NewRTPVP8Codec(webrtc.DefaultPayloadTypeVP8, 90000))

	api := webrtc.NewAPI(webrtc.WithMediaEngine(media))
	stunServers := getEnvs("STUN_URLS")
	log.Println("STUN_URLS:", stunServers)
	peerConnectionConfig := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: stunServers,
			},
		},
	}

	AppConfig = &Config{
		DBUser:            getEnv("DB_USER", "postgres"),
		DBPassword:        getEnv("DB_PASSWORD", "password"),
		DBName:            getEnv("DB_NAME", "products_db"),
		DBHost:            getEnv("DB_HOST", "localhost"),
		DBPort:            getEnv("DB_PORT", "5432"),
		PeerConnectionMap: make(map[string]chan *webrtc.Track), // sender to channel of track
		Api:               api,
		IceConfig:         &peerConnectionConfig,
	}
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func getEnvs(key string) []string {
	if value, exists := os.LookupEnv(key); exists {
		return strings.Split(value, " ")
	}
	return []string{}
}
