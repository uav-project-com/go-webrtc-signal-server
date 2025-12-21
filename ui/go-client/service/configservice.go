package service

import (
	"context"
	"database/sql"
	"errors"
)

type ConfigService interface {
  DatabaseProviderService
  FindLatestConfig(ctx context.Context) (*Config, error)
}

type configService struct {
  DatabaseProviderService
}

// Config represents a record in the `user` table from the SQLite database.
type Config struct {
	ID   int64  `json:"id"`
	Room string `json:"room"`
	Url  string `json:"ws_url"`
}

// FindLatestConfig returns the latest config for connecting to the WebSocket server.
func (s *configService) FindLatestConfig(ctx context.Context) (*Config, error) {
  row := s.Connection().QueryRowContext(ctx,
		"SELECT id, room, ws_url FROM config ORDER BY id DESC LIMIT 1",
	)

	var config Config
	if err := row.Scan(&config.ID, &config.Room, &config.Url); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		return nil, err
	}

	return &config, nil
}

func NewConfigService(dbService DatabaseProviderService) ConfigService {
  return &configService{dbService}
}
