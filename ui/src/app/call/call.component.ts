import {ChangeDetectorRef, Component, OnInit} from '@angular/core'
import {HttpClient} from '@angular/common/http'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {DATA_TYPE, MEDIA_TYPE, WebsocketService} from './websocket.service'

const DEBUG_LEVEL = 'log'

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {

  data2WaySender: any
  dataChannel: RTCDataChannel | null = null

  meetingId: string
  peerId: string
  userId: string
  message: string
  listMessage: string[] = []
  /** FOR WebSocket */
  websocketMess: string
  wsMessages: Message[] = []
  private msgSubscription: Subscription | null = null

  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }

  constructor(
    private cdr: ChangeDetectorRef,
    private http: HttpClient,
    private route: ActivatedRoute,
    private websocketSvc: WebsocketService) {
  }

  ngOnInit() {
    // TRACE LOG:
    if (DEBUG_LEVEL !== 'log') {
      window.console.log = () => {
      }
    }

    // INIT WebRTC

    // use http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId')
    this.peerId = this.route.snapshot.paramMap.get('peerID')
    this.userId = this.route.snapshot.paramMap.get('userId')
  }

  ngOnDestroy(): void {
    this.msgSubscription?.unsubscribe()
    this.websocketSvc.close()
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
      to: this.peerId,
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
      this.dataChannel.send(msg)
      this.listMessage.push(this.userId + ': ' + msg)
      this.message = ''
      this.cdr.detectChanges()
      if (msg === 'video') {
        await this.startStreamingVideoRtc()
      }
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
      let peerId = message.from
      let channel = message.channel
      message.msg = data
      console.log(`Received msg: ${JSON.stringify(message)}`)
      switch (data.type) {
        case 'offer':
          console.log('received msg: offer')
          if (channel === DATA_TYPE) {
            console.log(`offer ${channel}`)
            await this.handlerOfferDataChannel(data, message)
          } else if (channel === MEDIA_TYPE) {
            console.log(`offer ${channel}`)
            await this.handlerMediaOffer(peerId, data)
          }
          break
        case 'answer':
          console.log('received msg: answer')
          if (channel === DATA_TYPE) {
            console.log(`answer ${channel}`)
            if (this.data2WaySender.signalingState === 'have-local-offer') {
              await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.sdp))
            } else {
              console.warn('Ignoring duplicate answer')
            }
          } else if (channel === MEDIA_TYPE) {
            console.log(`answer ${channel}`)
            if (this.peers[peerId].signalingState === 'have-local-offer') {
              await this.peers[peerId].setRemoteDescription(new RTCSessionDescription(data.sdp))
            } else {
              console.warn('media: ignoring duplicate answer')
            }
          }
          break
        case 'candidate':
          console.log('received msg: candidate')
          if (channel === DATA_TYPE) {
            console.log(`candidate ${channel}`)
            await this.data2WaySender.addIceCandidate(new RTCIceCandidate(data.candidate))
          } else if (channel === MEDIA_TYPE) {
            console.log(`candidate ${channel}`)
            if (peerId in this.peers) {
              await this.peers[peerId].addIceCandidate(new RTCIceCandidate(data.candidate))
            } else {
              if (!(peerId in this.pendingCandidates)) {
                this.pendingCandidates[peerId] = []
              }
              this.pendingCandidates[peerId].push(data.candidate)
            }
          }
          break
        default:
          console.log(`Received unknown msg: ${JSON.stringify(data)}`)
      }
    } catch (e) {
      console.log(e)
      // normal message chatting, just a websocket chat example
      this.wsMessages.push(message)
    }
  }


  private async handlerMediaOffer(peerId: string, data: { sdp: RTCSessionDescriptionInit }) {
    // create new peer connection for receiving peer video stream
    this.peers[peerId] = this.createPeerConnection(this.userId, peerId)
    await this.peers[peerId].setRemoteDescription(new RTCSessionDescription(data.sdp))
    await this.sendAnswer(peerId)
    await this.addPendingCandidates(peerId)
  }

  private async handlerOfferDataChannel(data: { sdp: RTCSessionDescriptionInit }, message: Message) {
    await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.sdp))
    const answer = await this.data2WaySender.createAnswer()
    await this.data2WaySender.setLocalDescription(answer)

    const answerMsg: Message = {
      from: this.userId,
      to: message.from,
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
          from: this.userId,
          to: this.peerId,
          msg: btoa(JSON.stringify({type: 'candidate', candidate: event.candidate})),
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

      this.dataChannel.onopen = () => console.log('DataChannel Open')
    }

    // Assume We are the first one join to room, so let create that room: Create sender's data channel
    this.dataChannel = this.data2WaySender.createDataChannel('chat')

    this.dataChannel.onopen = () => console.log('Data channel opened!')
    this.dataChannel.onmessage = (event) => {
      console.log('Received message:', event.data)
      this.listMessage.push('Friend: ' + event.data)
      this.cdr.detectChanges()
      if (event.data === 'video') {
        this.startStreamingVideoRtc()
      }
    }

    // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
    // sending offer info to other peerIde
    this.data2WaySender.createOffer().then(async (offer: any) => {
      await this.data2WaySender.setLocalDescription(offer)
      console.log(new Date() + ' data2WaySender.createOffer')


      const data: Message = {
        from: this.userId,
        to: this.peerId,
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

  /** Convert code from git@github.com:uav-project-com/rt-socket-server-python.git **/
/// server
// WebRTC methods
  peers = {}
  pendingCandidates = {}
  localStream: MediaStream

  /**
   * get user's media for streaming
   */
  private getLocalStream = async (): Promise<void> => {
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({audio: false, video: true});
      console.log('Stream found');
    } catch (error) {
      console.error('Stream not found:', error);
    }
  }
  private createPeerConnection = (userId: string, peerId: string) => {
    const pc = new RTCPeerConnection(this.config)
    pc.onicecandidate = (event: any) => {
      if (event.candidate) {
        const msg = {
          from: userId,
          to: peerId,
          msg: btoa(JSON.stringify({type: 'candidate', candidate: event.candidate})),
          roomId: this.meetingId
        }
        this.websocketSvc.sendMessage(msg, MEDIA_TYPE)
      }
    }
    pc.ontrack = this.onAddStream
    this.localStream.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream)
    })
    console.log('PeerConnection created')
    return pc
  }


  private onAddStream(event: any) {
    // const newRemoteStreamElem = document.createElement('video')
    let newRemoteStreamElem: any = document.getElementById("senderVideo")
    if (newRemoteStreamElem.srcObject !== null) {
      newRemoteStreamElem = document.getElementById("receiverVideo")
    }
    newRemoteStreamElem.autoplay = true
    newRemoteStreamElem.srcObject = event.streams[0]
    newRemoteStreamElem.playsinline = true
    // document.querySelector('#remoteStreams').appendChild(newRemoteStreamElem)
  }

  private addPendingCandidates = async (peerId: string) => {
    if (peerId in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[peerId]) {
        await this.peers[peerId].addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }

  private sendOffer = async (userId: string) => {
    console.log('Send offer')
    await this.peers[userId].createOffer().then(
      async (sdp: any) => {
        await this.setAndSendLocalDescription(userId, sdp).then()
      },
      (error: any) => {
        console.error('Send offer failed: ', error)
      }
    )
  }

  private sendAnswer = async (peerId: string) => {
    console.log('Send answer')
    let answer = await this.peers[peerId].createAnswer()
    await this.setAndSendLocalDescription(peerId, answer)
  }

  private setAndSendLocalDescription = async (peerId: string, sdp: any) => {
    await this.peers[peerId].setLocalDescription(sdp)
    const msg = {
      from: this.userId,
      to: peerId,
      msg: btoa(JSON.stringify({type: sdp.type, sdp: sdp})),
      roomId: this.meetingId
    }
    this.websocketSvc.sendMessage(msg, MEDIA_TYPE)
  }

  /**
   * Start to call video
   * @private
   */
  private async startStreamingVideoRtc() {
    // setting local stream
    await this.getLocalStream().then(async () => {
        console.log('Ready')
        // Create sender peerConnection for sending flow of streaming video
        this.peers[this.userId] = this.createPeerConnection(this.userId, this.peerId)
        await this.sendOffer(this.userId)
        await this.addPendingCandidates(this.userId)
      }
    )
  }
}
