package webrtc

import "encoding/json"

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

// UnmarshalJSON decodes a JSON string into *Channel.
func (c *Channel) UnmarshalJSON(b []byte) error {
  // handle explicit null
  if string(b) == "null" {
    *c = ""
    return nil
  }
  var s string
  if err := json.Unmarshal(b, &s); err != nil {
    return err
  }
  *c = Channel(s)
  return nil
}

// MarshalJSON ensures Channel marshals as a JSON string.
func (c Channel) MarshalJSON() ([]byte, error) {
  return json.Marshal(string(c))
}

// String returns the underlying string so printing a *Channel shows the value.
func (c Channel) String() string { return string(c) }
