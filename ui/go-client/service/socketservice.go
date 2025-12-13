package service

import (
	"context"
	"github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/webrtc"
	"log"
)

type Socket struct {
	Uid *string
}

func (*Socket) NewSocket(uid *string) *Socket {
	return &Socket{Uid: uid}
}

// InitWebSocketKeepConnection is a placeholder method to keep the socket connection alive for UAV controller
func (*Service) InitWebSocketKeepConnection(ctx context.Context, svc Service, username *string) (*webrtc.WebsocketClient, error) {
	conf, err := svc.FindLatestConfig(ctx)
	if err != nil {
		log.Println("FindLatestConfig:", err)
		return nil, err
	}
	ws := webrtc.NewWebsocketClient(conf.Url)
	err = ws.Connect(conf.Room, username)
	if err != nil {
		log.Println("InitWebSocketKeepConnection:", err)
		return nil, err
	}
	return ws, nil
}
