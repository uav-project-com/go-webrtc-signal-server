package main

import (
	"fmt"
	"log"
	"time"

	"github.com/pion/webrtc/v4"
)

func main() {
	// Create a new RTCPeerConnection
	peerConnection, err := webrtc.NewPeerConnection(webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{"stun:stun.l.google.com:19302"},
			},
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	// Create a data channel
	dataChannel, err := peerConnection.CreateDataChannel("data", nil)
	if err != nil {
		log.Fatal(err)
	}

	// Set the handler for when the connection is established
	peerConnection.OnConnectionStateChange(func(s webrtc.PeerConnectionState) {
		fmt.Printf("Connection State has changed: %s\n", s.String())

		if s == webrtc.PeerConnectionStateConnected {
			fmt.Println("Peer connection established!")
		}
	})

	// Set the handler for when the data channel is opened
	dataChannel.OnOpen(func() {
		fmt.Printf("Data channel '%s'-'%d' open. Random messages will now be sent to any connected DataChannels every 5 seconds\n", dataChannel.Label(), dataChannel.ID())

		for range time.Tick(5 * time.Second) {
			message := fmt.Sprintf("Hello from Go at %s", time.Now().String())
			fmt.Printf("Sending '%s'\n", message)

			// Send the message as text
			sendErr := dataChannel.SendText(message)
			if sendErr != nil {
				log.Fatal(sendErr)
			}
		}
	})

	// Set the handler for when a message is received from the data channel
	dataChannel.OnMessage(func(msg webrtc.DataChannelMessage) {
		fmt.Printf("Message from DataChannel '%s': '%s'\n", dataChannel.Label(), string(msg.Data))
	})

	// Create an offer to send to the other peer
	offer, err := peerConnection.CreateOffer(nil)
	if err != nil {
		log.Fatal(err)
	}

	// Set the local description
	err = peerConnection.SetLocalDescription(offer)
	if err != nil {
		log.Fatal(err)
	}

	// Here you would typically send the offer to the other peer using a signaling server
	// For simplicity, we'll just print the offer
	fmt.Printf("Offer: %s\n", offer.SDP)

	// In a real application, you would receive the answer from the other peer via the signaling server
	// For simplicity, we'll just create an answer here
	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP: `v=0
o=- 0 0 IN IP4 127.0.0.1
s=-
t=0 0
a=group:BUNDLE 0
a=msid-semantic: WMS
m=application 9 UDP/DTLS/SCTP webrtc-datachannel
c=IN IP4 0.0.0.0
a=ice-ufrag:1234
a=ice-pwd:5678
a=fingerprint:sha-256 00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00:00
a=setup:active
a=mid:0
a=sctp-port:5000
a=max-message-size:262144
`,
	}

	// Set the remote description
	err = peerConnection.SetRemoteDescription(answer)
	if err != nil {
		log.Fatal(err)
	}

	// Block forever
	select {}
}
