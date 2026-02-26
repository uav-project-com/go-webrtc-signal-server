//go:build !dev

package api

import "github.com/gin-gonic/gin"

type UavAPI interface {
	StartUavControlHandler(ctx *gin.Context)
	UavCommandHandler(cmd string) error
	AutoStart()
}
