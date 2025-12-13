package service

import (
	"context"
	"database/sql"
	"errors"
)

// Config represents a record in the `user` table from the SQLite database.
type Config struct {
	ID   int64  `json:"id"`
	Room string `json:"room"`
	Url  string `json:"ws_url"`
}

// FindLatestConfig returns the latest config for connecting to the WebSocket server.
func (s *Service) FindLatestConfig(ctx context.Context) (*Config, error) {
	row := s.db.QueryRowContext(ctx,
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
