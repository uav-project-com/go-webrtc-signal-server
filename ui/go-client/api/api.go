package api

type Api interface{}

const (
  // CmdVideoToggle Các lệnh điều khiển Media cơ bản
  CmdVideoToggle = "toggle-video"
  CmdAudioToggle = "toggle-audio"

  // ActionCamera Hành động chính cho Camera chuyên sâu
  ActionCamera = "camera"

  // CmdCameraZoom Các lệnh con (sub-commands) cho Camera
  CmdCameraZoom   = "zoom"
  CmdCameraFocus  = "focus"
  CmdCameraSwitch = "switch"
  CmdCameraReset  = "reset"
  CmdCameraISO    = "iso"
)
