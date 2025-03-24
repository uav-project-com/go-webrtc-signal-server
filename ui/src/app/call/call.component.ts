import {ChangeDetectorRef, Component, OnInit} from '@angular/core'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {DATA_TYPE, MEDIA_TYPE, WebsocketService} from './websocket.service'
import {environment} from "../../environments/environment"

const ENABLE_LOCAL_VIDEO = true
const VIDEO_CALL_SIGNAL = '38ce19fc-651f-4cf0-8c20-b23db23a894e'

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {
  isChecked = true
  onCall = false

  data2WaySender: any
  dataChannel: RTCDataChannel | null = null

  meetingId: string
  userId: string
  message: string
  listMessage: string[] = []
  // list peerConnection: create new element for each peerId (not my userId)
  peers = {}
  pendingCandidates = {}
  localStream: MediaStream
  // líst
  idLocalList: string[] = []
  /** FOR WebSocket */
  websocketMess: string
  wsMessages: Message[] = []
  callBtnState = false
  private msgSubscription: Subscription | null = null

  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  private initCount = 0

  constructor(
    private cdr: ChangeDetectorRef,
    private route: ActivatedRoute,
    private websocketSvc: WebsocketService) {
  }

  private disableConsoleLevels(levels: (string)[]) {
    levels.forEach(level => {
      if (typeof console[level] === "function") {
        console[level] = (() => {})
      }
    })
  }

  ngOnInit() {
    // TRACE LOG:
    switch (environment.debug) {
      case "log":
        this.disableConsoleLevels(['debug', 'trace'])
        break
      case "info":
        this.disableConsoleLevels(['debug', 'trace', 'log'])
        break
      case "warn":
        this.disableConsoleLevels(['debug', 'trace', 'log', 'info'])
        break
      case "error":
        this.disableConsoleLevels(['debug', 'trace', 'log', 'info', 'warn'])
        break
      default:
        console.log("enabled all logging level")
    }

    // INIT WebRTC

    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId')
    this.userId = this.route.snapshot.paramMap.get('userId')
  }

  ngOnDestroy(): void {
    this.callBtnState = false
    this.msgSubscription?.unsubscribe()
    this.websocketSvc.close()
    this.hangup()
  }

  /**
   * Button event, start to:
   * - init websocket
   * - start to connect data-channel webrtc
   */
  connectWebsocket() {
    // INIT WebSocket - Auto connect to server
    this.websocketSvc.connect(this.meetingId, this.userId)
    this.msgSubscription = this.websocketSvc.getMessages().subscribe((message) => {
      if (message && !message.status) { // received message from peers
        this.handleSignalingData(message).then()
      } else if (message && message.status) { // response msg from websocket server
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
      from: this.userId,
      msg: this.websocketMess,
      roomId: this.meetingId
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
      const msg = text ? text : this.message
      if (msg === 'video') {
        await this.startVideoCall(this.userId).then(_ => {})
      }
      let payload: Message = {
        msg: msg === 'video' ? VIDEO_CALL_SIGNAL : msg,
        from: this.userId
      }
      this.dataChannel.send(JSON.stringify(payload))
      this.listMessage.push("Me:" + msg)
      this.message = ''
      document.getElementById("data-channel-text").textContent = ''
      this.cdr.detectChanges()
    } else {
      console.warn('dataChannel is not open')
    }
  }

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   */
  private startControlUav() {
    // create data channel
    this.setupDataChannelConnections().then()
  }

  private async handleSignalingData(message: Message) {
    try {
      // Trying to parse Webrtc messages
      let data = JSON.parse(atob(message.msg))
      let senderId = message.from
      let channel = message.channel
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
            } else {
              console.warn('Ignoring duplicate answer')
            }
            break
          case 'candidate':
            console.log(`candidate ${channel}`)
            await this.data2WaySender.addIceCandidate(new RTCIceCandidate(data.sdp))
            break
          default:
            console.warn(`Received unknown msg: ${JSON.stringify(data)}`)
        }
      else {
        await this.handleSignalingMediaMsg(data, senderId)
      }
    } catch (e) {
      console.trace(e)
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
      roomId: this.meetingId
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
          roomId: this.meetingId
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
        try{
          let payload: Message = JSON.parse(event.data)
          this.listMessage.push(`${payload.from}: ${payload.msg}`)
          this.cdr.detectChanges()
          if (payload.msg === VIDEO_CALL_SIGNAL) {
            this.startVideoCall(this.userId).then(_ => {})
          }
        } catch (e){
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
        roomId: this.meetingId
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

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   */
  private async startVideoCall(senderId: any) {
    // only call when local init RTCPeerConnection, disable local video => ko chạy đoạn code if này
    await navigator.mediaDevices.getUserMedia({video: true, audio: false}).then(stream => {
      console.log('Stream found')
      this.addLocalVideoElement(stream)
    })

    this.peers[senderId] = await this.init(senderId)
    // add track
    this.localStream.getTracks().forEach(track => {
      console.warn(`Adding track: ${track.kind}, ID: ${track.id}`)
      this.peers[senderId].addTrack(track, this.localStream)
    })
    console.warn("step 02")
    // The caller creates an offer and sets it as its local description before sending it to the remote peer via WebSocket.
    let offer = await this.peers[senderId].createOffer()
    await this.peers[senderId].setLocalDescription(offer)
    // sending offer to other peers (broadcast)
    this.websocketSvc.sendMessage({
      roomId: this.meetingId,
      msg: btoa(JSON.stringify({type: offer.type, sdp: offer}))
    }, MEDIA_TYPE)
    // adding to pending candidate list
    await this.addPendingCandidates(this.userId)

    // setting on-candidate event
    this.peers[senderId].onicecandidate = (e: any) => {
      console.log("ICE Candidate Event Triggered:", e.candidate)
      if (e.candidate) {
        // sending offer to other peers (broadcast)
        this.websocketSvc.sendMessage({
          roomId: this.meetingId,
          msg: btoa(JSON.stringify({type: 'candidate', sdp: e.candidate}))
        }, MEDIA_TYPE)
      }
    }
  }

  private async init(id: any) {
    console.warn(`init count: ${++this.initCount} with id: ${id}`)
    const pc = new RTCPeerConnection(this.config)

    // add track
    pc.ontrack = function (event: any) {
      console.trace("ontrack event triggered", event)
      console.trace("Streams received:", event.streams)

      if (event.streams.length === 0) {
        console.error("No streams available in ontrack event")
        return
      }
      let remoteVideo = document.getElementById(id) as HTMLVideoElement
      if (!remoteVideo) {
        remoteVideo = document.createElement('video')
        remoteVideo.autoplay = true
        remoteVideo.srcObject = event.streams[0]
        remoteVideo.id = id
        remoteVideo.playsInline = true
        document.querySelector('#remoteStreams').appendChild(remoteVideo)
      } else {
        console.trace("Updating existing remote video element")
        remoteVideo.srcObject = event.streams[0]
      }
    }
    pc.oniceconnectionstatechange = () => {
      console.warn("ICE Connection State:", pc.iceConnectionState)
    }

    pc.onsignalingstatechange = () => {
      console.warn("Signaling State:", pc.signalingState)
    }
    return pc
  }

  private addPendingCandidates = async (sid: string) => {
    console.warn("step 03")
    if (sid in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[sid]) {
        await this.peers[sid].addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }

  /**
   * Processing message for video peer-connection
   * @param data payload of websocket message
   * @param sid id of sender
   * @private
   */
  private async handleSignalingMediaMsg(data: any, sid: string) {
    switch (data.type) {
      case 'offer':
        console.warn("step 04")
        console.log(`callee received offer from peers ${JSON.stringify(data.sdp)}`)
        // notice: this.userId: id of receiver offer
        this.peers[sid] = await this.init(sid) // create new peer-connection object map with peerId for receive remote video
        await this.peers[sid].setRemoteDescription(new RTCSessionDescription(data.sdp))
        // we create an answer for send it back to other peers
        const answer = await this.peers[sid].createAnswer()
        // set local SDP for callee
        await this.peers[sid].setLocalDescription(answer)
        // sending sdp local back to caller
        this.websocketSvc.sendMessage({
          roomId: this.meetingId,
          msg: btoa(JSON.stringify({type: answer.type, sdp: answer}))
        }, MEDIA_TYPE)
        // adding all pending candidate to peer connection object
        await this.addPendingCandidates(sid).then()
        // setting on-candidate event
        this.peers[sid].onicecandidate = (e: any) => {
          console.log("ICE Candidate Event Triggered:", e.candidate)
          if (e.candidate) {
            // sending offer to other peers (broadcast)
            this.websocketSvc.sendMessage({
              roomId: this.meetingId,
              msg: btoa(JSON.stringify({type: 'candidate', sdp: e.candidate}))
            }, MEDIA_TYPE)
          }
        }
        break
      case 'answer':
        console.warn("step 05")
        console.log(`answer: ${JSON.stringify(data.sdp)}`)
        if (this.peers[sid].signalingState !== "stable") {
          await this.peers[sid].setRemoteDescription(new RTCSessionDescription(data.sdp))
        } else {
          console.warn("Skipping setRemoteDescription(answer) because state is already stable")
        }
        break
      case 'candidate':
        console.warn("step 06")
        console.log(`candidate: ${JSON.stringify(data.sdp)}`)
        if (sid in this.peers) {
          console.warn("add new candidate")
          await this.peers[sid].addIceCandidate(new RTCIceCandidate(data.sdp))
        } else {
          console.warn(`pending candidate ${sid}`)
          if (!(sid in this.pendingCandidates)) {
            console.warn("candidate lst clear")
            this.pendingCandidates[sid] = []
          }
          this.pendingCandidates[sid].push(data.sdp)
        }
        break
      case 'removeTrack':
        await this.removeTrack(sid)
        break
      default:
        console.warn(`Received unknown msg: ${JSON.stringify(data)}`)
    }
  }

  hangup() {
    // this.peers[this.peerId].close()
    this.onCall = false
  }

  toggleVideoCall(event: any) {
    this.isChecked = event.target.checked
    if (this.onCall) {
      this.toggleMediaCall(this.isChecked).then()
    }
  }
  private async toggleMediaCall(enable: boolean) {
    if (!enable) {
      console.log("Disabling video call");
      // 🔥 Notify other peers that media is stopped
      this.websocketSvc.sendMessage({
        roomId: this.meetingId,
        msg: btoa(JSON.stringify({type: 'removeTrack', sid: this.userId}))
      }, MEDIA_TYPE);
    } else {
      const localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: false})
      this.addLocalVideoElement(localStream)
      for (const track of localStream.getTracks()) {
        for (const sid in this.peers) {
          this.peers[sid].addTrack(track, localStream)
          // Renegotiate the connection to update media
          const offer = await this.peers[sid].createOffer()
          await this.peers[sid].setLocalDescription(offer)
          this.websocketSvc.sendMessage({
            roomId: this.meetingId,
            msg: btoa(JSON.stringify({type: offer.type, sdp: offer}))
          }, MEDIA_TYPE)
        }
      }
      console.log('Local media resuming')
    }
  }

  addLocalVideoElement = (stream: any) => {
    this.onCall = true
    this.localStream = stream
    if (ENABLE_LOCAL_VIDEO) { // giả sử máy Bob là máy watching only (điều khiển UAV)
      let localVideo = document.getElementById(this.userId) as HTMLVideoElement
      if (!localVideo) {
        console.log("create local video")
        const newRemoteStreamElem = document.createElement('video')
        newRemoteStreamElem.autoplay = true
        newRemoteStreamElem.srcObject = stream
        newRemoteStreamElem.id = this.userId
        document.querySelector('#localStream').appendChild(newRemoteStreamElem)
      } else {
        localVideo.srcObject = stream
      }
    }
  }

  private async removeTrack(sid: string) {
    if (this.peers[sid] != null) {
      const senders = this.peers[sid].getSenders(); // Get all RTP senders

      for (const sender of senders) {
        if (sender.track) {
          sender.track.stop(); // Stop the media track
          await this.peers[sid].removeTrack(sender); // Remove the track from the peer connection
        }
      }

      // Remove video element
      const videoElement = document.getElementById(sid);
      if (videoElement) videoElement.remove();
    }
  }
}
