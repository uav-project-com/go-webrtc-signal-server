package dto

type PeerInfo struct {
	MeetingID string `json:"meetingId"`
	UserId    string `json:"userId"`
	PeerId    string `json:"peerId"`
	IsSender  bool   `json:"isSender"`
}

// Message Định dạng tin nhắn JSON cho websocket
type Message struct {
	From    *string `json:"from,omitempty"` // Server sẽ thêm "from" khi gửi đi
	To      *string `json:"to,omitempty"`
	Msg     string  `json:"msg"`
	RoomID  string  `json:"roomId"`
	Channel *string `json:"channel,omitempty"`
}

type WsResponse struct {
	Status  int       `json:"status"`
	Message string    `json:"msg"`
	Time    int64     `json:"time"`
	Peers   *[]string `json:"peers,omitempty"` // Server sẽ thêm "from" khi gửi đi
}
