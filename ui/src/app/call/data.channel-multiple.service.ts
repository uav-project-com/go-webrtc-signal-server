import {Injectable} from '@angular/core';
import {DATA_TYPE, WebsocketService} from './websocket.service';
import {CallBackInfo, RoomInfo} from './RoomInfo';
import {Message} from './Message';

export const REQUEST_VIDEO_CALL = '38ce19fc-651f-4cf0-8c20-b23db23a894e'
@Injectable({
  providedIn: 'root'
})
export class DataChannelRTCMultiService {
  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  private dataChannels = {}
  // vừa gửi vừa nhận message => 2ways (khác với video, mỗi cặp peer cần 2 object)
  private peers = {}
  private pendingCandidates = {}
  private readonly roomId: string;
  private readonly userId: string;
  private callback: CallBackInfo;


  constructor(private websocketSvc: WebsocketService, room: RoomInfo, callback: CallBackInfo) {
    this.roomId = room.roomId
    this.userId = room.userId
    this.callback = callback
  }

  /**
   * Chatting with webrtc Data-channel
   */
  public async sendMsg(message: string) {
    // send broadcast to all other peers
    for (const sid in this.dataChannels) {
      if (this.dataChannels[sid].readyState === 'open') {
        console.warn(`sending video req to ${sid}`)
        const payload: Message = {
          msg: message === 'video' ? REQUEST_VIDEO_CALL : message,
          from: this.userId,
          to: sid
        }
        const str = JSON.stringify(payload);
        console.log(`Sending: ${message} from ${this.userId} to ${sid}`)
        this.dataChannels[sid].send(str)
      }
    }
  }


  /**
   * Init webrtc streaming from Raspi5 Client (Bob) and Android control Device (Alice)
   */
  async setupDataChannelConnections(sid: string, isCaller: boolean) {
    console.log(new Date())
    console.log(`setup data channel for ${sid}`)
    // Unlike video, DataChannel requires a bidirectional connection:
    const peer = new RTCPeerConnection(this.config)
    this.peers[sid] = peer
    // candidate event
    peer.onicecandidate = (event: { candidate: any }) => {
      if (event.candidate) {
        const answerMsg: Message = {
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        }
        this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
      }
    }

    // // Handle incoming DataChannel from remote peer `sid`
    peer.ondatachannel = (event: { channel: RTCDataChannel }) => {
      this.dataChannels[sid] = event.channel // Store the data channel reference

      this.dataChannels[sid].onmessage = (messageEvent: any) => {
        console.log('Received message from sender:', messageEvent.data)
        this.handleDataMessage(messageEvent);
      }

      this.dataChannels[sid].onopen = () => {
        console.log('DataChannel Open')
      }
    }

    console.log(`before create offer, userId: ${this.userId}, sid: ${sid}`)
    if (isCaller) { // nếu 2 bên chưa gửi offer, chiếm lấy việc gửi offer ngay tức thì
      // Assume We are the first one join to room, so let create that room: Create sender's data channel
      this.dataChannels[sid] = peer.createDataChannel('chat')
      this.dataChannels[sid].onmessage = (event: any) => {
        this.handleDataMessage(event);
      }
      // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
      // sending offer info to other peerIde
      peer.createOffer().then(async (offer: any) => {
        await peer.setLocalDescription(offer)
        console.log(new Date() + ` data2WaySender.createOffer ${sid}`)
        const data: Message = {
          msg: btoa(JSON.stringify({type: offer.type, sdp: offer})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        }
        this.websocketSvc.sendMessage(data, DATA_TYPE)
      })
    }
    peer.addEventListener('connectionstatechange', (_event: any) => {
      console.log('connectionstatechange-state:' + peer.connectionState)
      if (peer.connectionState === 'connected') {
        console.log('datachannel connected!')
      }
    })

  }

  private handleDataMessage(event: any) {
    const context = this.callback.context
    console.log('Received message:', event.data)
    if (event.data) {
      try {
        const payload: Message = JSON.parse(event.data)
        this.callback.uiControlCallback(context, `${payload.from}: ${payload.msg}`)
        if (payload.msg === REQUEST_VIDEO_CALL) {
          this.callback.videoHandlerCallback(context, true, payload.from)
        }
      } catch (e) {
        this.callback.uiControlCallback(context, event.data)
        console.log(e)
      }
    }
  }

  /**
   * Xử lý tín hiệu message kết nối data-channel qua websocket
   * @param message msg websocket
   */
  public async handleSignalingData(message: any) {
    const data = message.msg
    const sid = message.from
    console.log(`handleSignalingData: ${JSON.stringify(message)} this.peers[sid]: ${this.peers[sid] == null}`)
    if (sid === this.userId) return;
    if (!this.peers[sid] && data.type === 'offer') {
      await this.setupDataChannelConnections(sid, false)
    }
    switch (data.type) {
      case 'offer':
        await this.handlerOfferDataChannel(sid, data)
        await this.addPendingCandidates(sid)
        break
      case 'answer':
        console.log('received msg: answer')
        if (this.peers[sid].signalingState === 'have-local-offer') {
          await this.peers[sid].setRemoteDescription(new RTCSessionDescription(data.sdp))
        }
        break
      case 'candidate':
        if (sid in this.peers && this.peers[sid].remoteDescription) {
          await this.peers[sid].addIceCandidate(new RTCIceCandidate(data.sdp))
        } else {
          if (!(sid in this.pendingCandidates)) {
            this.pendingCandidates[sid] = []
          }
          this.pendingCandidates[sid].push(data.sdp)
        }
        break
      default:
    }
  }

  private async handlerOfferDataChannel(sid: string, data: any) {
    console.log(`handler offer from ${sid} with data ${data}`)
    const peer = this.peers[sid]
    await peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
    console.log(`2 peer is: ${JSON.stringify(peer)}`)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    this.peers[sid] = peer
    const answerMsg: Message = {
      msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
      roomId: this.roomId,
      from: this.userId,
      to: sid
    }
    this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
  }

  /**
   * Get candidates from list pending when other peers sent it too early
   * @param sid sender candidate
   */
  private addPendingCandidates = async (sid: string) => {
    if (sid in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[sid]) {
        await this.peers[sid].addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }
}
