//go:build dev

package main

import (
	"log"

	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/api"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile)
	defer func() {
		if err := recover(); err != nil {
			log.Printf("Recovered from panic: %v", err)
		}
	}()

	database, err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize DB: %v", err)
	}
	defer closeDB()

	dbService := service.NewDatabaseProviderService(database)
	userService := service.NewUserService(dbService)
	configService := service.NewConfigService(dbService)
	socketService := service.NewSocketService(dbService, configService)
	startHandler := api.NewUavAPI(userService, socketService, userService)

	router := configRoutes(userService, startHandler)
	if err := router.Run(":3001"); err != nil {
		return
	}
}
