package repo

import (
	"github.com/jinzhu/gorm"
	"go-rest-api/models"
)

// ProductRepo interface for public function
type ProductRepo interface {
	FindAll() []models.Product
}

// productRepo implement interface ProductRepo
type productRepo struct {
	db *gorm.DB
}

func (p *productRepo) FindAll() []models.Product {
	var products []models.Product
	p.db.Find(&products)
	return products
}

// NewProductRepository dependency injection
func NewProductRepository(db *gorm.DB) ProductRepo {
	return &productRepo{db: db}
}
