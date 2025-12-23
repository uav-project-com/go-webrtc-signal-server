package service

import (
	"context"
	"log"

  "github.com/uav-project-com/go-webrtc-signal-server/go-rtc-client/webrtc"
)

type SocketService interface {
  InitWebSocketKeepConnection(ctx context.Context, username *string) (*Socket, error)
  InitDataChannel(channelInfo *ChannelInfo) (*webrtc.DataChannelClient, error)
  InitVideoChannel(channelInfo *ChannelInfo) (*webrtc.VideoChannelClient, error)
}

type socketService struct {
  DatabaseProviderService
  configSvc ConfigService
}

type Socket struct {
  Config   *Config
  WsClient *webrtc.WebsocketClient
}

type ChannelInfo struct {
  Sid      *string
  RoomId   *string
  IsMaster *bool
  WsClient *webrtc.WebsocketClient
}

func NewSocketService(d DatabaseProviderService, c ConfigService) SocketService {
  return &socketService{DatabaseProviderService: d, configSvc: c}
}

// InitWebSocketKeepConnection is a placeholder method to keep the socket connection alive for UAV controller
func (s *socketService) InitWebSocketKeepConnection(ctx context.Context, username *string) (*Socket, error) {
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
  return &Socket{Config: conf, WsClient: ws}, nil
}

func (s *socketService) InitDataChannel(channelInfo *ChannelInfo) (*webrtc.DataChannelClient, error) {
  var dataChannel *webrtc.DataChannelClient
  var err error
  dataChannel, err = webrtc.NewDataChannelClientWithWS(*channelInfo.Sid, *channelInfo.RoomId, *channelInfo.IsMaster, channelInfo.WsClient)
  if err != nil {
    return nil, err
  }
  return dataChannel, nil
}

func (s *socketService) InitVideoChannel(channelInfo *ChannelInfo) (*webrtc.VideoChannelClient, error) {
  var videoChannel *webrtc.VideoChannelClient
  var err error
  videoChannel, err = webrtc.NewVideoChannelClientWithWs(*channelInfo.Sid, *channelInfo.RoomId, *channelInfo.IsMaster, channelInfo.WsClient)
  if err != nil {
    return nil, err
  }
  return videoChannel, nil
}
