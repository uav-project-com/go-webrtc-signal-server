package dto

type PeerInfo struct {
	MeetingID string `json:"meetingId"`
	UserId    string `json:"userId"`
	PeerId    string `json:"peerId"`
	IsSender  bool   `json:"isSender"`
}
