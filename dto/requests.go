package dto

// JoinRequest make a websocket request to join into a RoomID
type JoinRequest struct {
	RoomID string `json:"roomId"`
	UserID string `json:"userId"`
}
