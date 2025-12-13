package main

import (
  "crypto/sha256"
  "database/sql"
  "encoding/hex"
  "fmt"
  "log"
  "time"

  jwt "github.com/appleboy/gin-jwt/v2"
  "github.com/gin-gonic/gin"
  "github.com/google/uuid"
  _ "github.com/mattn/go-sqlite3"
  "github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/service"
)

type Login struct {
  Username string `form:"username" json:"username" binding:"required"`
  Password string `form:"password" json:"password" binding:"required"`
}

func hashSHA256(password string) string {
  // Chuyển chuỗi mật khẩu thành slice byte
  hash := sha256.New()
  hash.Write([]byte(password))

  // Tính toán giá trị hash và trả về kết quả dưới dạng chuỗi hex
  return hex.EncodeToString(hash.Sum(nil))
}

func configRoutes(user service.Service) *gin.Engine {
  r := gin.Default()
  uuidString := uuid.New().String()
  authMiddleware, err := jwt.New(&jwt.GinJWTMiddleware{
    Realm:      "example zone",
    Key:        []byte(uuidString + "eb43b856"),
    Timeout:    3 * time.Hour,
    MaxRefresh: 6 * time.Hour,
    Authenticator: func(c *gin.Context) (interface{}, error) {
      var loginVals Login
      if err := c.ShouldBind(&loginVals); err != nil {
        return "", jwt.ErrMissingLoginValues
      }

      userID := loginVals.Username
      password := loginVals.Password
      hashPassword := hashSHA256(password)

      // Validate username/password
      user, err := user.FindByUsername(c, userID)
      if err != nil {
        log.Printf("FindByUsername error: %v\n", err)
        return nil, jwt.ErrFailedAuthentication
      }
      if user.Username == "admin" && hashPassword == user.Password {
        return &Login{Username: userID}, nil
      }
      return nil, jwt.ErrFailedAuthentication
    },
    IdentityHandler: func(c *gin.Context) interface{} {
      claims := jwt.ExtractClaims(c)
      return claims["id"]
    },
  })

  if err != nil {
    panic(err)
  }

  r.POST("/login", authMiddleware.LoginHandler)
  r.GET("/refresh", authMiddleware.RefreshHandler)

  auth := r.Group("/auth")
  auth.Use(authMiddleware.MiddlewareFunc())
  auth.GET("/hello", func(c *gin.Context) {
    c.JSON(200, gin.H{"message": "Hello from protected route"})
  })
  return r
}

var db *sql.DB

// InitDB sẽ khởi tạo kết nối DB một lần
func initDB() (*sql.DB, error) {
  var err error
  db, err = sql.Open("sqlite3", "/mnt/x/workspace/0.FPV/go-webrtc-signal-server/ui/go-client/SQLite.db")
  if err != nil {
    return nil, fmt.Errorf("open sqlite db: %w", err)
  }

  // Bạn có thể kiểm tra kết nối tại đây để đảm bảo nó đã sẵn sàng
  if err := db.Ping(); err != nil {
    return nil, fmt.Errorf("ping sqlite db: %w", err)
  }

  return db, nil
}

// Đảm bảo đóng kết nối DB khi ứng dụng kết thúc
func closeDB() {
  if err := db.Close(); err != nil {
    log.Printf("Error closing DB: %v", err)
  }
}

func main() {
  log.SetFlags(log.LstdFlags | log.Lshortfile) // Enable file:line logging
  defer func() { // keep server live when panic error occurred
    if err := recover(); err != nil {
      log.Printf("Recovered from panic: %v", err)
    }
  }()
  // Khởi tạo kết nối DB
  database, err := initDB()
  if err != nil {
    log.Fatalf("Failed to initialize DB: %v", err)
  }
  defer closeDB()
  svc := service.NewService(database)
  router := configRoutes(*svc)
  err = router.Run(":8080")
  if err != nil {
    return
  }
}
