package service

import (
	"context"
	"log"

  "github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/webrtc"
)

type SocketService interface {
  InitWebSocketKeepConnection(ctx context.Context, username *string) (*webrtc.WebsocketClient, error)
  InitDataChannel(channelInfo *DataChannel) (*webrtc.DataChannelClient, error)
}

type socketService struct {
  DatabaseProviderService
  configSvc ConfigService
}

type Socket struct {
	Uid *string
}

type DataChannel struct {
  Sid      *string
  RoomId   *string
  IsMaster *bool
  WsClient *webrtc.WebsocketClient
}

func NewSocketService(d DatabaseProviderService, c ConfigService) SocketService {
  return &socketService{DatabaseProviderService: d, configSvc: c}
}

// InitWebSocketKeepConnection is a placeholder method to keep the socket connection alive for UAV controller
func (s *socketService) InitWebSocketKeepConnection(ctx context.Context, username *string) (*webrtc.WebsocketClient, error) {
  conf, err := s.configSvc.FindLatestConfig(ctx)
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

func (s *socketService) InitDataChannel(channelInfo *DataChannel) (*webrtc.DataChannelClient, error) {
  var dataChannel *webrtc.DataChannelClient
  var err error
  dataChannel, err = webrtc.NewDataChannelClientWithWS(*channelInfo.Sid, *channelInfo.RoomId, *channelInfo.IsMaster, channelInfo.WsClient)
  if err != nil {
    return nil, err
  }
  dataChannel.SendMsg()
  return dataChannel, nil
}
