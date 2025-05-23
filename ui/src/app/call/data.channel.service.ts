import { Injectable } from '@angular/core';
import {DATA_TYPE, WebsocketService} from './websocket.service';
import {RoomInfo} from './RoomInfo';
import {Message} from './Message';

export const VIDEO_CALL_SIGNAL = '38ce19fc-651f-4cf0-8c20-b23db23a894e'
export const VIDEO_CALL_ACCEPT = '8a93ca36-1be0-4164-b59b-582467f721e9e'

@Injectable({
  providedIn: 'root'
})
export class DataChannelRTCService {
  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  private _dataChannel: RTCDataChannel | null = null
  data2WaySender: any
  private readonly roomId: string;
  private readonly userId: string;


  constructor(private websocketSvc: WebsocketService, room: RoomInfo) {
    this.roomId = room.roomId
    this.userId = room.userId
  }

  /**
   * Chatting with webrtc Data-channel
   */
  public async sendMsg(message: string) {
    if (this._dataChannel.readyState === 'open') {
      console.log('Sending: ' + message)
      const payload: Message = {
        msg: message === 'video' ? VIDEO_CALL_SIGNAL : message,
        from: this.userId
      }
      this._dataChannel.send(JSON.stringify(payload))
    }
  }
  public get dataChannel(): RTCDataChannel | null {
    return this._dataChannel;
  }



  /**
   * Init webrtc streaming from Raspi5 Client (Bob) and Android control Device (Alice)
   */
  public async setupDataChannelConnections(context: any, videoHandlerCallback: any, uiControlCallback: any) {
    // Unlike video, DataChannel requires a bidirectional connection:
    this.data2WaySender = new RTCPeerConnection(this.config)
    // candidate event
    this.data2WaySender.onicecandidate = (event: { candidate: any }) => {
      if (event.candidate) {
        const answerMsg: Message = {
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomId
        }
        this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
      }
    }

    // ondatachannel event to chat
    this.data2WaySender.ondatachannel = (event: { channel: RTCDataChannel }) => {
      console.log('Data channel received on receiver')
      this._dataChannel = event.channel // Store the data channel reference

      this._dataChannel.onmessage = (messageEvent) => {
        console.log('Received message from sender:', messageEvent.data)
        uiControlCallback(context, messageEvent.data)
      }

      this._dataChannel.onopen = () => {
        console.log('DataChannel Open')
      }
    }

    // Assume We are the first one join to room, so let create that room: Create sender's data channel
    this._dataChannel = this.data2WaySender.createDataChannel('chat')

    this._dataChannel.onopen = () => console.log('Data channel opened!')
    this._dataChannel.onmessage = (event) => {
      console.log('Received message:', event.data)
      if (event.data) {
        try {
          const payload: Message = JSON.parse(event.data)
          uiControlCallback(context, `${payload.from}: ${payload.msg}`)
          if (payload.msg === VIDEO_CALL_SIGNAL) {
            this.sendMsg(VIDEO_CALL_ACCEPT) // accept for video call
          } else if (payload.msg === VIDEO_CALL_ACCEPT) {
            videoHandlerCallback(context, payload.from)
          }
        } catch (e) {
          uiControlCallback(context, event.data)
          console.log(e)
        }
      }
    }

    // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
    // sending offer info to other peerIde
    this.data2WaySender.createOffer().then(async (offer: any) => {
      await this.data2WaySender.setLocalDescription(offer)
      console.log(new Date() + ' data2WaySender.createOffer')
      const data: Message = {
        msg: btoa(JSON.stringify({type: offer.type, sdp: offer})),
        roomId: this.roomId
      }
      this.websocketSvc.sendMessage(data, DATA_TYPE)
    })

    this.data2WaySender.addEventListener('connectionstatechange', (_event: any) => {
      console.log('connectionstatechange-state:' + this.data2WaySender.connectionState)
      if (this.data2WaySender.connectionState === 'connected') {
        console.log('datachannel connected!')
      }
    })

  }
  public async handleSignalingData(data: any) {
    switch (data.type) {
      case 'offer':
        console.log('received msg: offer')
        await this.handlerOfferDataChannel(data)
        break
      case 'answer':
        console.log('received msg: answer')
        if (this.data2WaySender.signalingState === 'have-local-offer') {
          await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.sdp))
        }
        break
      case 'candidate':
        await this.data2WaySender.addIceCandidate(new RTCIceCandidate(data.sdp))
        break
      default:
    }
  }

  private async handlerOfferDataChannel(data: { sdp: RTCSessionDescriptionInit }) {
    await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.sdp))
    const answer = await this.data2WaySender.createAnswer()
    await this.data2WaySender.setLocalDescription(answer)

    const answerMsg: Message = {
      msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
      roomId: this.roomId
    }
    this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
  }
}
