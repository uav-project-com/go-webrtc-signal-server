import {ChangeDetectorRef, Component, OnInit} from '@angular/core'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {DATA_TYPE, WebsocketService} from './websocket.service'
import {environment} from '../../environments/environment'
import {WebRTCService} from './webrtc.service';
import {RoomInfo} from './RoomInfo';

const ENABLE_LOCAL_VIDEO = true
const VIDEO_CALL_SIGNAL = '38ce19fc-651f-4cf0-8c20-b23db23a894e'
const VIDEO_CALL_ACCEPT = '8a93ca36-1be0-4164-b59b-582467f721e9e'

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {
  isChecked = true

  data2WaySender: any
  dataChannel: RTCDataChannel | null = null
  message: string
  listMessage: string[] = []

  // líst
  /** FOR WebSocket */
  websocketMess: string
  wsMessages: Message[] = []
  callBtnState = false
  private msgSubscription: Subscription | null = null

  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  private videoCallSvc: WebRTCService
  private roomInfo: RoomInfo;

  constructor(
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private websocketSvc: WebsocketService) {
  }

  private disableConsoleLevels(levels: (string)[]) {
    levels.forEach(level => {
      if (typeof console[level] === 'function') {
        console[level] = (() => {
        })
      }
    })
  }

  ngOnInit() {
    // TRACE LOG:
    switch (environment.debug) {
      case 'log':
        this.disableConsoleLevels(['debug', 'trace'])
        break
      case 'info':
        this.disableConsoleLevels(['debug', 'trace', 'log'])
        break
      case 'warn':
        this.disableConsoleLevels(['debug', 'trace', 'log', 'info'])
        break
      case 'error':
        this.disableConsoleLevels(['debug', 'trace', 'log', 'info', 'warn'])
        break
      default:
        console.log('enabled all logging level')
    }

    // INIT WebRTC

    // start the call
    this.roomInfo = new RoomInfo()
    this.roomInfo.roomId = this.route.snapshot.paramMap.get('meetingId')
    this.roomInfo.userId = this.route.snapshot.paramMap.get('userId')
  }

  ngOnDestroy(): void {
    this.callBtnState = false
    this.msgSubscription?.unsubscribe()
    this.websocketSvc.close()
    this.videoCallSvc.hangup()
  }

  /**
   * Button event, start to:
   * - init websocket
   * - start to connect data-channel webrtc
   */
  connectWebsocket() {
    // INIT WebSocket - Auto connect to server
    this.websocketSvc.connect(this.roomInfo.roomId, this.roomInfo.userId)
    this.msgSubscription = this.websocketSvc.getMessages().subscribe((message) => {
      if (message && !message.status) { // received message from peers
        this.handleSignalingData(message).then()
      } else if (message?.status) { // response msg from websocket server
        console.log(`response: ${JSON.stringify(message)}`)
        if (message.status === 200 && message.msg.startsWith('onConnected')) {
          console.log('====-Websocket connected! Start to data-channel connection-===')
          // websocket is ok now, start to call Webrtc
          this.startControlUav()
          this.callBtnState = true
        }
      }
    })
  }

  /***************************** WebSocket Functions *******************************/
  /**
   * Normal chatting with websocket
   */
  sendWsMessage() {
    const data: Message = {
      from: this.roomInfo.userId,
      msg: this.websocketMess,
      roomId: this.roomInfo.roomId
    }
    this.websocketSvc.sendMessage(data)
    this.wsMessages.push(data)
  }

  /**
   * Chatting with webrtc Data-channel
   */
  async sendMsg(text?: string) {
    if (this.dataChannel.readyState === 'open') {
      console.log('Sending: ' + this.message)
      const msg = text || this.message
      const payload: Message = {
        msg: msg === 'video' ? VIDEO_CALL_SIGNAL : msg,
        from: this.roomInfo.userId
      }
      this.dataChannel.send(JSON.stringify(payload))
      this.listMessage.push('Me:' + msg)
      this.message = ''
      document.getElementById('data-channel-text').textContent = ''
      this.cdr.detectChanges()
    }
  }

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   */
  private startControlUav() {
    // create data channel
    this.setupDataChannelConnections().then(() => {
        // init video call service
        this.videoCallSvc = new WebRTCService(
          this.websocketSvc,
          this.roomInfo
        )
      }
    )
  }

  private async handleSignalingData(message: Message) {
    try {
      // Trying to parse Webrtc messages
      const data = JSON.parse(atob(message.msg))
      const senderId = message.from
      const channel = message.channel
      message.msg = data
      console.log(`Received msg: ${JSON.stringify(message)}`)
      if (message.channel === DATA_TYPE)
        switch (data.type) {
          case 'offer':
            console.log('received msg: offer')
            console.log(`offer ${channel}`)
            await this.handlerOfferDataChannel(data)
            break
          case 'answer':
            console.log('received msg: answer')
            console.log(`answer ${channel}`)
            if (this.data2WaySender.signalingState === 'have-local-offer') {
              await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.sdp))
            }
            break
          case 'candidate':
            console.log(`candidate ${channel}`)
            await this.data2WaySender.addIceCandidate(new RTCIceCandidate(data.sdp))
            break
          default:
        }
      else {
        await this.videoCallSvc.handleSignalingMediaMsg(data, senderId, this.addRemoteVideoElement, this.addLocalVideoElement)
      }
    } catch (e) {
      console.log(e)
      // normal message chatting, just a websocket chat example
      this.wsMessages.push(message)
    }
  }

  private async handlerOfferDataChannel(data: { sdp: RTCSessionDescriptionInit }) {
    await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.sdp))
    const answer = await this.data2WaySender.createAnswer()
    await this.data2WaySender.setLocalDescription(answer)

    const answerMsg: Message = {
      msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
      roomId: this.roomInfo.roomId
    }
    this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
  }

  /**
   * Init webrtc streaming from Raspi5 Client (Bob) and Android control Device (Alice)
   */
  private async setupDataChannelConnections() {
    // Unlike video, DataChannel requires a bidirectional connection:
    this.data2WaySender = new RTCPeerConnection(this.config)
    // candidate event
    this.data2WaySender.onicecandidate = (event: { candidate: any }) => {
      if (event.candidate) {
        const answerMsg: Message = {
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomInfo.roomId
        }
        this.websocketSvc.sendMessage(answerMsg, DATA_TYPE)
      }
    }

    // ondatachannel event to chat
    this.data2WaySender.ondatachannel = (event: { channel: RTCDataChannel }) => {
      console.log('Data channel received on receiver')
      this.dataChannel = event.channel // Store the data channel reference

      this.dataChannel.onmessage = (messageEvent) => {
        console.log('Received message from sender:', messageEvent.data)
        this.listMessage.push('Peer: ' + messageEvent.data)
        this.cdr.detectChanges()
      }

      this.dataChannel.onopen = () => {
        console.log('DataChannel Open')
      }
    }

    // Assume We are the first one join to room, so let create that room: Create sender's data channel
    this.dataChannel = this.data2WaySender.createDataChannel('chat')

    this.dataChannel.onopen = () => console.log('Data channel opened!')
    this.dataChannel.onmessage = (event) => {
      console.log('Received message:', event.data)
      if (event.data) {
        try {
          const payload: Message = JSON.parse(event.data)
          this.listMessage.push(`${payload.from}: ${payload.msg}`)
          this.cdr.detectChanges()
          if (payload.msg === VIDEO_CALL_SIGNAL) {
            this.sendMsg(VIDEO_CALL_ACCEPT) // accept for video call
          } else if (payload.msg === VIDEO_CALL_ACCEPT) {
            this.videoCallSvc.startVideoCall(payload.from, this.addRemoteVideoElement, this.addLocalVideoElement).then()
          }
        } catch (e) {
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
        roomId: this.roomInfo.roomId
      }
      // sending offer, TODO: check ws ready state to send, else addEventListener `open` event to send offer
      this.websocketSvc.sendMessage(data, DATA_TYPE)
    })

    this.data2WaySender.addEventListener('connectionstatechange', (_event: any) => {
      console.log('connectionstatechange-state:' + this.data2WaySender.connectionState)
      if (this.data2WaySender.connectionState === 'connected') {
        console.log('datachannel connected!')
      }
    })

  }

  // WebRTC methods for media streaming

  toggleVideoCall(event: any) {
    this.isChecked = event.target.checked
    if (this.videoCallSvc.onCall) {
      this.videoCallSvc.toggleMediaCall(this.isChecked, this.addLocalVideoElement).then()
    }
  }

  addRemoteVideoElement(stream: any, sid: string) {
    let video = document.getElementById(sid) as HTMLVideoElement
    if (!video) {
      video = document.createElement('video')
      video.autoplay = true
      video.srcObject = stream
      video.id = sid
      video.playsInline = true
      document.querySelector('#remoteStreams').appendChild(video)
    } else {
      console.log('Updating existing remote video element')
      video.srcObject = stream
    }
  }
  addLocalVideoElement(stream: any, sid: string) {
    if (ENABLE_LOCAL_VIDEO) { // giả sử máy Bob là máy watching only (điều khiển UAV)
      const localVideo = document.getElementById(sid) as HTMLVideoElement
      if (!localVideo) {
        console.log('create local video')
        const newRemoteStreamElem = document.createElement('video')
        newRemoteStreamElem.autoplay = true
        newRemoteStreamElem.srcObject = stream
        newRemoteStreamElem.id = sid
        document.querySelector('#localStream').appendChild(newRemoteStreamElem)
      } else {
        localVideo.srcObject = stream
      }
    }
  }
}
