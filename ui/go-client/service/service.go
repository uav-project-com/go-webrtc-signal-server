package service

import "database/sql"

// DatabaseProviderService provides shared database access to all implemented services.
type DatabaseProviderService interface {
  Connection() *sql.DB
}

type service struct {
	db *sql.DB
}

func NewDatabaseProviderService(db *sql.DB) DatabaseProviderService {
  return &service{db: db}
}

func (service *service) Connection() *sql.DB {
  return service.db
}
