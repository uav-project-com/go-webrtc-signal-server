import {ChangeDetectorRef, Component, OnInit} from '@angular/core'
import {HttpClient} from '@angular/common/http'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {DATA_TYPE, MEDIA_TYPE, WebsocketService} from './websocket.service'

const DEBUG_LEVEL = 'log'
const ENABLE_LOCAL_VIDEO = false

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
  callBtnState = false
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

    // use http://192.168.20.191:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://192.168.20.191:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId')
    this.peerId = this.route.snapshot.paramMap.get('peerID')
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
        // websocket is ok now, start to call Webrtc
        await this.startVideoCall().then()
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
      if (message.channel === DATA_TYPE)
        switch (data.type) {
          case 'offer':
            console.log('received msg: offer')
            console.log(`offer ${channel}`)
            await this.handlerOfferDataChannel(data, message)
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
            console.log('received msg: candidate')
            console.log(`candidate ${channel}`)
            await this.data2WaySender.addIceCandidate(new RTCIceCandidate(data.candidate))
            break
          default:
            console.warn(`Received unknown msg: ${JSON.stringify(data)}`)
        }
      else {
        await this.handleSignalingMediaMsg(data, peerId)
      }
    } catch (e) {
      console.log(e)
      // normal message chatting, just a websocket chat example
      this.wsMessages.push(message)
    }
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
        this.startVideoCall()
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
// list peerConnection: create new element for each peerId (not my userId)
  peers = {}
  pendingCandidates = {}
  localStream: MediaStream

  // WebRTC methods for media streaming

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   */
  private async startVideoCall() {
    await this.init().then(async () => {
      await this.call()
    })
  }

  private async init() {
    // init
    this.peers[this.peerId] = new RTCPeerConnection(this.config)
    this.peers[this.peerId].ontrack = this.onAddStream
    // add track
    if (this.userId === 'alice')
      await navigator.mediaDevices.getUserMedia({video: true, audio: false}).then(stream => {
        console.log('Stream found');
        if (ENABLE_LOCAL_VIDEO && this.userId === 'bob') {
          console.log("create local video")
          this.localStream = stream;
          const newRemoteStreamElem = document.createElement('video')
          newRemoteStreamElem.autoplay = true
          newRemoteStreamElem.srcObject = this.localStream
          newRemoteStreamElem.ariaLabel = "local"
          document.querySelector('#remoteStreams').appendChild(newRemoteStreamElem)
        }
        // add track
        this.peers[this.peerId].addTrack(stream.getTracks()[0], stream);

      });
    // setting on-candidate event
    this.peers[this.peerId].onicecandidate = (e: any) => {
      console.log("ICE Candidate Event Triggered:", e.candidate)
      if (e.candidate) {
        // sending offer to other peers (broadcast)
        this.websocketSvc.sendMessage({
          from: this.userId,
          roomId: this.meetingId,
          msg: btoa(JSON.stringify({type: 'candidate', sdp: e.candidate}))
        }, MEDIA_TYPE)
      }
    }
  }

  private onAddStream(event: any) {
    console.log("create remote video")
    const newRemoteStreamElem = document.createElement('video')
    newRemoteStreamElem.autoplay = true
    newRemoteStreamElem.srcObject = event.streams[0]
    newRemoteStreamElem.ariaLabel = "remote"
    document.querySelector('#remoteStreams').appendChild(newRemoteStreamElem)
  }

  private async call() {
    // The caller creates an offer and sets it as its local description before sending it to the remote peer via WebSocket.
    let offer = await this.peers[this.peerId].createOffer();
    await this.peers[this.peerId].setLocalDescription(offer);
    // sending offer to other peers (broadcast)
    this.websocketSvc.sendMessage({
      from: this.userId,
      roomId: this.meetingId,
      msg: btoa(JSON.stringify({type: offer.type, sdp: offer}))
    }, MEDIA_TYPE)
    // adding to pending candidate list
    await this.addPendingCandidates(this.peerId)
  }

  private addPendingCandidates = async (peerId: string) => {
    if (peerId in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[peerId]) {
        await this.peers[peerId].addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }

  /**
   * Processing message for video peer-connection
   * @param data payload of websocket message
   * @param peerId id of partner
   * @private
   */
  private async handleSignalingMediaMsg(data: any, peerId: string) {
    switch (data.type) {
      case 'offer':
        console.log(`callee received offer from peers ${peerId}`)
        // notice: this.userId: id of receiver offer
        await this.peers[peerId].setRemoteDescription(new RTCSessionDescription(data.sdp));
        // we create an answer for send it back to other peers
        const answer = await this.peers[peerId].createAnswer();
        // set local SDP for callee
        await this.peers[peerId].setLocalDescription(answer);
        // sending sdp local back to caller
        this.websocketSvc.sendMessage({
          from: this.userId,
          roomId: this.meetingId,
          msg: btoa(JSON.stringify({type: answer.type, sdp: answer}))
        }, MEDIA_TYPE)
        // adding to pending list
        await this.addPendingCandidates(peerId).then()
        break
      case 'answer':
        console.log('answer')
        await this.peers[peerId].setRemoteDescription(new RTCSessionDescription(data.sdp));
        break
      case 'candidate':
        console.log('candidate')
        if (peerId in this.peers) {
          await this.peers[peerId].addIceCandidate(new RTCIceCandidate(data.sdp))
        } else {
          if (!(peerId in this.pendingCandidates)) {
            this.pendingCandidates[peerId] = []
          }
          this.pendingCandidates[peerId].push(data.sdp)
        }
        break
      default:
        console.warn(`Received unknown msg: ${JSON.stringify(data)}`)
    }
  }

  hangup() {
    this.peers[this.peerId].close();
  }
}
