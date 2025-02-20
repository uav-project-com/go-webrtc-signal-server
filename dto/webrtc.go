package dto

type PeerInfo struct {
	MeetingID string `json:"meetingId"`
	UserId    string `json:"userId"`
	PeerId    string `json:"peerId"`
	IsSender  bool   `json:"isSender"`
}

// Message Định dạng tin nhắn JSON cho websocket
type Message struct {
	From   string `json:"from,omitempty"` // Server sẽ thêm "from" khi gửi đi
	To     string `json:"to"`
	Msg    string `json:"msg"`
	RoomID string `json:"roomId"`
}
