package service

import (
  "context"
  "database/sql"
  "errors"
)

// User represents a record in the `user` table from the SQLite database.
type User struct {
  ID       int64  `json:"id"`
  Username string `json:"username"`
  Password string `json:"password"`
}

// FindByUsername returns the user record for the given username.
// It uses the Service's shared *sql.DB and accepts a context for cancellation.
func (s *Service) FindByUsername(ctx context.Context, username string) (*User, error) {
  row := s.db.QueryRowContext(ctx,
    "SELECT id, username, password FROM user WHERE username = ?",
    username,
  )

  var user User
  if err := row.Scan(&user.ID, &user.Username, &user.Password); err != nil {
    if errors.Is(err, sql.ErrNoRows) {
      return nil, err
    }
    return nil, err
  }

  return &user, nil
}
