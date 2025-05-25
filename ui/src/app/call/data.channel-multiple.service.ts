import {Injectable} from '@angular/core';
import {DATA_TYPE, WebsocketService} from './websocket.service';
import {CallBackInfo, RoomInfo} from './RoomInfo';
import {Message} from './Message';

export const VIDEO_CALL_SIGNAL = '38ce19fc-651f-4cf0-8c20-b23db23a894e'
export const VIDEO_CALL_ACCEPT = '8a93ca36-1be0-4164-b59b-582467f721e9e'

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
  private setRemoteSdp = false
  private setLocalSdp = false


  constructor(private websocketSvc: WebsocketService, room: RoomInfo, callback: CallBackInfo) {
    this.roomId = room.roomId
    this.userId = room.userId
    this.callback = callback
  }

  /**
   * Chatting with webrtc Data-channel
   */
  public async sendMsg(message: string) {
    const payload: Message = {
      msg: message === 'video' ? VIDEO_CALL_SIGNAL : message,
      from: this.userId
    }
    const str = JSON.stringify(payload);
    // send broadcast to all other peers
    for (const sid in this.dataChannels) {
      if (this.dataChannels[sid].readyState === 'open') {
        console.log(`Sending: ${message} from ${this.userId} to ${sid}`)
        this.dataChannels[sid].send(str)
      }
    }
  }


  /**
   * Init webrtc streaming from Raspi5 Client (Bob) and Android control Device (Alice)
   */
  private async setupDataChannelConnections(sid: string) {
    console.warn(new Date())
    console.warn(`setup data channel for ${sid}`)
    // Unlike video, DataChannel requires a bidirectional connection:
    const peer = new RTCPeerConnection(this.config)
    this.peers[sid] = peer
    // candidate event
    peer.onicecandidate = (event: { candidate: any }) => {
      if (event.candidate) {
        const answerMsg: Message = {
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomId
        }
        this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
      }
    }

    // // Handle incoming DataChannel from remote peer `sid`
    peer.ondatachannel = (event: { channel: RTCDataChannel }) => {
      console.error('Creating datachannel 1')
      this.dataChannels[sid] = event.channel // Store the data channel reference

      this.dataChannels[sid].onmessage = (messageEvent: any) => {
        console.log('Received message from sender:', messageEvent.data)
        this.handleDataMessage(messageEvent);
      }

      this.dataChannels[sid].onopen = () => {
        console.log('DataChannel Open')
      }
    }

    console.warn(`before create offer, userId: ${this.userId}, sid: ${sid}`)
    // Assume We are the first one join to room, so let create that room: Create sender's data channel
    console.error('Creating datachannel 2')
    this.dataChannels[sid] = peer.createDataChannel('chat')
    this.dataChannels[sid].onmessage = (event: any) => {
      this.handleDataMessage(event);
    }
    // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
    // sending offer info to other peerIde
    peer.createOffer().then(async (offer: any) => {
      if (!this.setRemoteSdp && !this.setLocalSdp) {
        await peer.setLocalDescription(offer)
        this.setLocalSdp = true
      }
      // await peer.setLocalDescription(offer)
      console.warn(new Date() + ` data2WaySender.createOffer ${sid}`)
      const data: Message = {
        msg: btoa(JSON.stringify({type: offer.type, sdp: offer})),
        roomId: this.roomId,
        from: this.userId,
        to: sid
      }
      this.websocketSvc.sendMessage(data, DATA_TYPE)
    })
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
        if (payload.msg === VIDEO_CALL_SIGNAL) {
          this.sendMsg(VIDEO_CALL_ACCEPT).then(_ => {
          }) // accept for video call
        } else if (payload.msg === VIDEO_CALL_ACCEPT) {
          this.callback.videoHandlerCallback(context, payload.from)
        }
      } catch (e) {
        this.callback.uiControlCallback(context, event.data)
        console.log(e)
      }
    }
  }

  public async handleSignalingData(message: any) {
    const data = message.msg
    const sid = message.from
    console.warn(`handleSignalingData: ${JSON.stringify(message)} this.peers[sid]: ${this.peers[sid] == null}`)
    if (sid === this.userId) return;
    if (!this.peers[sid]) {
      await this.setupDataChannelConnections(sid)
    }
    switch (data.type) {
      case 'offer':
        await this.handlerOfferDataChannel(sid, data)
        await this.addPendingCandidates(sid)
        break
      case 'answer':
        console.log('received msg: answer')
        if (!this.setRemoteSdp) {
          await this.peers[sid].setRemoteDescription(new RTCSessionDescription(data.sdp))
          this.setRemoteSdp = true
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
    console.warn(`handler offer from ${sid} with data ${data}`)
    const peer = this.peers[sid]
    if (!peer) {
      console.error(`peer ${sid} null`)
    } else {
      console.warn(`1 peer is: ${JSON.stringify(peer)}`)
    }
    await peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
    this.setRemoteSdp = true
    console.warn(`2 peer is: ${JSON.stringify(peer)}`)
    const answer = await peer.createAnswer()
    await peer.setLocalDescription(answer)
    this.peers[sid] = peer
    const answerMsg: Message = {
      msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
      roomId: this.roomId
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
