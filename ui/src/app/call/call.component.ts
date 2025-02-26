import {ChangeDetectorRef, Component, OnInit} from '@angular/core'
import {HttpClient} from '@angular/common/http'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {WebsocketService} from './websocket.service'

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
  peerID: string
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
    // INIT WebRTC

    // use http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId')
    this.peerID = this.route.snapshot.paramMap.get('peerID')
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
        this.handlerMsg(message).then()
      } else if (message && message.status) { // response msg from websocket server
        console.log(`response: ${message.status} ${message.msg}`)
        if (message.status === 200 && message.msg.startsWith('onConnected')) {
          console.log('Websocket connected!')
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
      to: this.peerID,
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
        // await this.startStreamingVideoRtc()
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
    // TODO setting up video connection
  }

  private async handlerMsg(message: Message) {
    console.log(`Received msg: ${message}`)
    try {
      // Trying to parse Webrtc messages
      let data = JSON.parse(atob(message.msg))
      if (data.type === 'offer') {
        console.log('received msg: offer')
        await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.offer))
        const answer = await this.data2WaySender.createAnswer()
        await this.data2WaySender.setLocalDescription(answer)

        const answerMsg: Message = {
          from: this.userId,
          to: message.from,
          msg: btoa(JSON.stringify({type: 'answer', answer: this.data2WaySender.localDescription})),
          roomId: this.meetingId
        }
        console.log(`Answer: ${JSON.stringify({type: 'answer', answer: this.data2WaySender.localDescription})}`)

        this.websocketSvc.sendMessage(answerMsg)
      } else if (data.type === 'answer') {
        console.log('received msg: answer')
        if (this.data2WaySender.signalingState === 'have-local-offer') {
          await this.data2WaySender.setRemoteDescription(new RTCSessionDescription(data.answer))
        } else {
          console.warn('Ignoring duplicate answer')
        }
      } else if (data.type === 'candidate') {
        console.log('received msg: candidate')
        await this.data2WaySender.addIceCandidate(new RTCIceCandidate(data.candidate))
      } else {
        console.warn(`Received unknown msg: ${data}`)
      }
    } catch (e) {
      console.warn(e)
      // normal message chatting, just a websocket chat example
      this.wsMessages.push(message)
    }
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
          to: this.peerID,
          msg: btoa(JSON.stringify({type: 'candidate', candidate: event.candidate})),
          roomId: this.meetingId
        }
        console.log(`candidate: ${JSON.stringify({type: 'candidate', candidate: event.candidate})}`)
        this.websocketSvc.sendMessage(answerMsg)
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
        // this.startStreamingVideoRtc()
      }
    }


    // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
    // sending offer info to other side
    this.data2WaySender.createOffer().then(async (offer: any) => {
      this.data2WaySender.setLocalDescription(offer)
      console.log(new Date() + ' data2WaySender.createOffer')


      const data: Message = {
        from: this.userId,
        to: this.peerID,
        msg: btoa(JSON.stringify({type: 'offer', offer: offer})),
        roomId: this.meetingId
      }
      console.log(`offer: ${JSON.stringify({type: 'offer', offer: offer})}`)
      // sending offer, TODO: check ws ready state to send, else addEventListener `open` event to send offer
      this.websocketSvc.sendMessage(data)
    })

    this.data2WaySender.addEventListener('connectionstatechange', (_event: any) => {
      console.log('connectionstatechange-state:' + this.data2WaySender.connectionState)
      if (this.data2WaySender.connectionState === 'connected') {
        console.log('datachannel connected!')
      }
    })

  }
}
