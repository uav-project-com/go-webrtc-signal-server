package config

import (
	"fmt"
	"github.com/jinzhu/gorm"
	_ "github.com/jinzhu/gorm/dialects/postgres"
	"go-rest-api/models"
	"log"
)

var DB *gorm.DB

func ConnectDatabase() {
	var err error

	//dsn := fmt.Sprintf("host=%s port=%s user=%s dbname=%s password=%s sslmode=disable",
	//	AppConfig.DBHost,
	//	AppConfig.DBPort,
	//	AppConfig.DBUser,
	//	AppConfig.DBName,
	//	AppConfig.DBPassword,
	//)

	dsn := fmt.Sprintf("host=%s port=%s user=%s dbname=%s password=%s sslmode=disable",
		AppConfig.Database.Host,
		AppConfig.Database.Port,
		AppConfig.Database.Username,
		AppConfig.Database.Name,
		AppConfig.Database.Password,
	)
	log.Printf("host database: \n%v", dsn)

	DB, err = gorm.Open("postgres", dsn)
	if err != nil {
		panic("Failed to connect to database!")
	}

	DB.AutoMigrate(&models.Product{})
}
