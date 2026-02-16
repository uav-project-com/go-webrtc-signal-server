//go:build !dev

package main

import (
	"log"

	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/api"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile) // Enable file:line logging
	defer func() {                               // keep server live when panic error occurred
		if err := recover(); err != nil {
			log.Printf("Recovered from panic: %v", err)
		}
	}()
	// Khởi tạo kết nối DB
	database, err := initDB()
	if err != nil {
		log.Fatalf("Failed to initialize DB: %v", err)
	}
	defer closeDB()
	// initialize services
	dbService := service.NewDatabaseProviderService(database)
	userService := service.NewUserService(dbService)
	configService := service.NewConfigService(dbService)
	socketService := service.NewSocketService(dbService, configService)
	startHandler := api.NewUavAPI(userService, socketService, userService)
	// Auto-start UAV client mode
	startHandler.AutoStart()

	router := configRoutes(userService, startHandler)
	err = router.Run(":3001")
	if err != nil {
		return
	}
}
