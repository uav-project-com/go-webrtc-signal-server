package service

import (
	"database/sql"
	"fmt"

	_ "github.com/mattn/go-sqlite3"
)

// User represents a record in the `user` table from the SQLite database.
type User struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
	Password string `json:"password"`
}

// FindByUsername opens the sqlite database file at dbPath (e.g. `/tmp/db.data`) and
// returns row from the `user` table selecting columns `ID, username, password`.
func FindByUsername(username string) (*User, error) {
	db, err := sql.Open("sqlite3", "X:\\workspace\\0.FPV\\go-webrtc-signal-server\\ui\\go-client\\SQLite.db")
	if err != nil {
		return nil, fmt.Errorf("open sqlite db: %w", err)
	}
	defer func(db *sql.DB) {
		err := db.Close()
		if err != nil {
			fmt.Printf("close sqlite db: %v", err)
		}
	}(db)

	row, err := db.Query("SELECT ID, username, password FROM user where username = ?", username)
	if err != nil {
		return nil, fmt.Errorf("query user table: %w", err)
	}

	var user User
	// Scan vào các biến tương ứng
	err = row.Scan(&user)
	if err != nil {
		return nil, fmt.Errorf("row error: %w", err)
	}
	return &user, nil
}
