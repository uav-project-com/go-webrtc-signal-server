package webrtc

// Signal message DTOs and enums similar to the TypeScript SignalMsg

type Channel string

const (
	ChannelDataRtc Channel = "dt"
	ChannelWebrtc  Channel = "md"
)

type SignalType string

const (
	SignalOffer     SignalType = "offer"
	SignalAnswer    SignalType = "answer"
	SignalCandidate SignalType = "candidate"
)

type SignalMsg struct {
	Channel *Channel    `json:"channel,omitempty"`
	From    string      `json:"from"`
	To      string      `json:"to,omitempty"`
	Msg     interface{} `json:"msg"`
	RoomId  string      `json:"roomId,omitempty"`
	Status  int         `json:"status,omitempty"`
}
