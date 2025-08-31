export enum Channel {
  DataRtc = 'dt', Webrtc = 'md'
}
export enum SignalType {
  offer = 'offer', answer = 'answer', candidate = 'candidate'
}
export interface SignalMsg {
  channel?: Channel // để phân biệt khi gửi chung 1 kênh signal như websocket server
  from: string
  // When peers are more than two, no need `to`, just send broadcast except send to `from` userId
  to?: string
  msg: any
  roomId?: string
}
