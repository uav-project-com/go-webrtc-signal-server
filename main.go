package main

import (
	"go-rest-api/config"
	"go-rest-api/controllers"
	"go-rest-api/repo"
	"go-rest-api/routes"
	"go-rest-api/service"
	"log"
)

func main() {
	log.SetFlags(log.LstdFlags | log.Lshortfile) // Enable file:line logging
	defer func() {                               // keep server live when panic error occurred
		if err := recover(); err != nil {
			log.Printf("Recovered from panic: %v", err)
		}
	}()
	config.LoadConfig("")
	config.ConnectDatabase()
	// Initialize repository, service, and controller
	productRepo := repo.NewProductRepository(config.DB)
	productService := service.NewProductService(productRepo)
	productController := controllers.NewProductController(productService)

	videoCallService := service.NewVideoCallService()
	videoController := controllers.NewWebRtcController(videoCallService)

	r := routes.NewRoute(productController, videoController)
	port := config.AppConfig.App.Port
	log.Println("server run in: " + port)
	err := r.Run(":" + port)
	if err != nil {
		log.Fatal(err)
		return
	}
}
