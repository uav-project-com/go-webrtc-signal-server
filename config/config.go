package config

import (
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v4"
	"gopkg.in/yaml.v3"
)

func CorsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT")

		if c.Request.Method == http.MethodOptions {
			c.Writer.WriteHeader(http.StatusNoContent) // Use `WriteHeader` instead of `AbortWithStatus`
			return
		}

		c.Next() // Continue processing the request
	}
}

func EnableSocket() websocket.Upgrader {
	// Upgrade is used to upgrade HTTP connections to WebSocket connections
	return websocket.Upgrader{
		CheckOrigin: func(r *http.Request) bool {
			// Allow all connections by default (for development purposes)
			return true
		},
	}
}

type Database struct {
	Host     string `yaml:"host"`
	Port     string `yaml:"port"`
	Username string `yaml:"username"`
	Password string `yaml:"password"`
	Name     string `yaml:"name"`
}

type App struct {
	Port string `yaml:"port"`
}

type Config struct {
	Database          Database `yaml:"database"`
	App               App      `yaml:"app"`
	stun              []string `yaml:"stun-urls"`
	PeerConnectionMap map[string]chan *webrtc.TrackLocalStaticRTP
	Api               *webrtc.API
	IceConfig         *webrtc.Configuration
}

type Sdp struct {
	Sdp string
}

var AppConfig *Config

// LoadConfig : default profile `dev` => app-dev.yaml
func LoadConfig(resourceDir string) {
	profile, have := os.LookupEnv("ENV")
	if !have {
		profile, have = os.LookupEnv("env")
		if !have {
			profile = "dev"
		}
	}
	// Read the YAML file
	// Use filepath.Join for OS-independent path construction
	filePath := filepath.Join(resourceDir, "app-"+profile+".yaml")
	data, err := os.ReadFile(filePath)
	if err != nil {
		log.Fatal(err)
	}
	// Parse the YAML file into the struct
	err = yaml.Unmarshal(data, &AppConfig)
	if err != nil {
		log.Fatal(err)
	}

	media := webrtc.MediaEngine{}

	// Set up the codecs you want to use.
	// Only support VP8(video compression), this makes our proxying code simpler
	// Create a new MediaEngine
	// Register the VP8 codec
	if err := media.RegisterCodec(webrtc.RTPCodecParameters{
		RTPCodecCapability: webrtc.RTPCodecCapability{
			MimeType:    "video/VP8",
			ClockRate:   90000,
			Channels:    0, // Video codecs have 0 channels
			SDPFmtpLine: "",
		},
		PayloadType: 96, // Default payload type for VP8
	}, webrtc.RTPCodecTypeVideo); err != nil {
		log.Println("Error registering video:", err)
		// Alternatively, register default codecs (including VP8)
		if err := media.RegisterDefaultCodecs(); err != nil {
			log.Fatal(err)
		}
	}

	// Alternatively, register default codecs (including VP8)
	if err := media.RegisterDefaultCodecs(); err != nil {
		log.Fatal(err)
	}

	// Create a new API with the MediaEngine
	api := webrtc.NewAPI(webrtc.WithMediaEngine(&media))

	peerConnectionConfig := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: AppConfig.stun,
			},
		},
	}
	AppConfig.IceConfig = &peerConnectionConfig
	AppConfig.Api = api
	AppConfig.PeerConnectionMap = make(map[string]chan *webrtc.TrackLocalStaticRTP) // sender to channel of track
}

func getEnv(key, fallback string) string {
	if value, exists := os.LookupEnv(key); exists {
		return value
	}
	return fallback
}

func getEnvs(key string) []string {
	if value, exists := os.LookupEnv(key); exists {
		return strings.Split(value, ",")
	}
	return []string{}
}
