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
	config.ConnectDatabase()
	// Initialize repository, service, and controller
	productRepo := repo.NewProductRepository(config.DB)
	productService := service.NewProductService(productRepo)
	productController := controllers.NewProductController(productService)

	videoCallService := service.NewVideoCallService()
	videoController := controllers.NewWebRtcController(videoCallService)

	r := routes.NewRoute(productController, videoController)
	err := r.Run()
	if err != nil {
		log.Fatal(err)
		return
	}
}
