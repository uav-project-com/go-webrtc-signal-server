package service

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
	"strings"

	"github.com/golang-jwt/jwt/v4"
)

type UserService interface {
  DatabaseProviderService
  FindByUsername(ctx context.Context, username string) (*UserInfo, error)
  ExtractToken(tokenRaw string) (*UserInfo, error)
}

type userService struct {
  DatabaseProviderService
}

func NewUserService(svc DatabaseProviderService) UserService {
  return &userService{DatabaseProviderService: svc}
}

// UserInfo represents a record in the `user` table from the SQLite database.
type UserInfo struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// FindByUsername returns the user record for the given username.
// It uses the DatabaseProviderService's shared *sql.DB and accepts a context for cancellation.
func (s *userService) FindByUsername(ctx context.Context, username string) (*UserInfo, error) {
  db := s.Connection()
  row := db.QueryRowContext(ctx,
		"SELECT id, username, password FROM user WHERE username = ?",
		username,
	)

  var user UserInfo
	if err := row.Scan(&user.ID, &user.Username, &user.Password); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, err
		}
		return nil, err
	}

	return &user, nil
}

func (s *userService) ExtractToken(tokenRaw string) (*UserInfo, error) {
	// Parse token without verifying signature because signing key is held by the HTTP server.
	// We only extract claims (`sub` or `uid`) and then load the authoritative user record from DB.
	token := strings.Split(tokenRaw, "Bearer ")[1]
	parser := new(jwt.Parser)
	t, _, err := parser.ParseUnverified(token, jwt.MapClaims{})
	if err != nil {
		return nil, err
	}

	claims, ok := t.Claims.(jwt.MapClaims)
	if !ok {
		return nil, errors.New("invalid token claims")
	}

	// Prefer `sub` (user ID), otherwise fall back to `uid` (username)
	if subRaw, found := claims["sub"]; found {
		subStr, ok := subRaw.(string)
		if !ok {
			return nil, errors.New("invalid sub claim type")
		}
		id, err := strconv.ParseInt(subStr, 10, 64)
		if err != nil {
			return nil, err
		}

		if uname, found := claims["uid"]; found {
			username, ok := uname.(string)
			if !ok {
				return nil, errors.New("invalid sub claim type")
			}
      var user = UserInfo{
				ID:       id,
				Username: username,
			}
			return &user, nil
		}
	}
	return nil, errors.New("token does not contain sub or uid claims")
}
