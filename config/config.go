package config

import (
	"github.com/gin-gonic/gin"
	"gopkg.in/yaml.v3"
	"log"
	"os"
	"path/filepath"
	"strings"

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
	PeerConnectionMap map[string]chan *webrtc.Track
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
	media.RegisterCodec(webrtc.NewRTPVP8Codec(webrtc.DefaultPayloadTypeVP8, 90000))

	api := webrtc.NewAPI(webrtc.WithMediaEngine(media))
	peerConnectionConfig := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: AppConfig.stun,
			},
		},
	}
	AppConfig.IceConfig = &peerConnectionConfig
	AppConfig.Api = api
	AppConfig.PeerConnectionMap = make(map[string]chan *webrtc.Track) // sender to channel of track
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
