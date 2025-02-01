package service

import (
	"go-rest-api/models"
	"go-rest-api/repo"
)

type ProductService interface {
	FindAll() []models.Product
}

// productService implement interface ProductService with some dependencies
type productService struct {
	productRepo repo.ProductRepo
}

func (u *productService) FindAll() []models.Product {
	return u.productRepo.FindAll()
}

// NewProductService function for dependency injection
func NewProductService(repo repo.ProductRepo) ProductService {
	return &productService{productRepo: repo}
}
