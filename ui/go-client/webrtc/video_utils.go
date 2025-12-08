package webrtc

import (
	"log"

	pionwebrtc "github.com/pion/webrtc/v4"
)

// VideoElementUtil is a Go-friendly port of the browser-side VideoElementUtil.
// Because Go does not manipulate the DOM, this utility acts as a coordinator that
// keeps mappings of remote streams and invokes application callbacks for UI wiring.
type VideoElementUtil struct {
	MicBtnClass               string
	HangUpClass               string
	RemoteVideoContainerClass string

	videoChannelSvc *VideoChannelClient

	// Callbacks that the application can set to perform UI actions when streams arrive
	OnAddVideoElement func(userID string, containerSelector *string)
	OnToggleMic       func()
	OnHangUp          func()
}

// NewVideoElementUtil constructs the util with default class names
func NewVideoElementUtil() *VideoElementUtil {
	return &VideoElementUtil{
		MicBtnClass:               "toggle-mic-btn",
		HangUpClass:               "hangup",
		RemoteVideoContainerClass: "participant-grid",
	}
}

// AddVideoElement signals the host application to create/attach a video element for a stream.
// `containerSelector` mirrors the JS input (e.g. ".participant-grid"); in Go it's a pointer to
// indicate optional presence.
func (v *VideoElementUtil) AddVideoElement(streamID string, userID string, containerSelector *string) {
	log.Printf("VideoElementUtil: AddVideoElement for user=%s stream=%s container=%v", userID, streamID, containerSelector)
	if v.OnAddVideoElement != nil {
		v.OnAddVideoElement(userID, containerSelector)
	}
}

// InitControls wires the video channel service to this util and installs listeners.
// `localVideoSelector` is a pointer representing the caller's local video element selector (if any).
// `listRemoteStream` is a map that the util will update with remote stream identifiers (or metadata) keyed by userID.
func (v *VideoElementUtil) InitControls(videoSvc *VideoChannelClient, localVideoSelector *string, listRemoteStream map[string]string, userIds []string) {
	v.videoChannelSvc = videoSvc
	// register remote stream listener
	videoSvc.AddOnRemoteStreamListener(func(tracks []*pionwebrtc.TrackRemote, from string) {
		log.Printf("VideoElementUtil: remote stream arrived from %s (tracks=%d)", from, len(tracks))
		// store a representation (e.g., join track IDs) in the provided map
		if len(tracks) > 0 {
			// use the codec payload type as a lightweight identifier or track ID
			listRemoteStream[from] = tracks[0].ID()
		} else {
			listRemoteStream[from] = ""
		}
		// notify host application to create video element
		if v.OnAddVideoElement != nil {
			v.OnAddVideoElement(from, &v.RemoteVideoContainerClass)
		}
	})

	// Attempt to invoke addOnLocalStream to let caller prepare local tracks; in Go the callback should create tracks
	videoSvc.AddOnLocalStream(func() {
		log.Printf("VideoElementUtil: AddOnLocalStream callback invoked (Go host should create local tracks via SetLocalTrack)")
		// host is expected to call SetLocalTrack on the videoSvc when ready
	})

	// wire mic/hangup callbacks to host if set
	if v.OnToggleMic != nil {
		// host will handle binding to UI; here we just log
		log.Printf("VideoElementUtil: OnToggleMic is set")
	}
	if v.OnHangUp != nil {
		log.Printf("VideoElementUtil: OnHangUp is set")
	}
}
