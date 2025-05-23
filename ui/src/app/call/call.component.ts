import {ChangeDetectorRef, Component, OnInit} from '@angular/core'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {DATA_TYPE, MEDIA_TYPE, WebsocketService} from './websocket.service'
import {environment} from '../../environments/environment'
import {WebRTCService} from './webrtc.service';
import {RoomInfo} from './RoomInfo';
import {DataChannelRTCService} from './data.channel.service';

const ENABLE_LOCAL_VIDEO = true

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {
  isChecked = true


  message: string
  listMessage: string[] = []

  // líst
  /** FOR WebSocket */
  websocketMess: string
  wsMessages: Message[] = []
  callBtnState = false
  private msgSubscription: Subscription | null = null

  // WebRTC services
  private dataChannelSvc: DataChannelRTCService;
  private videoCallSvc: WebRTCService
  // Room information
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
        try {
          // Trying to parse Webrtc messages
          const data = JSON.parse(atob(message.msg))
          const senderId = message.from
          const channel = message.channel
          message.msg = data
          console.log(`Received msg: ${JSON.stringify(message)} with channel ${channel}`)
          if (message.channel === DATA_TYPE) {
            this.dataChannelSvc.handleSignalingData(data).then(_ => {})
          } else if (message.channel === MEDIA_TYPE) {
            this.videoCallSvc.handleSignalingMediaMsg(data, senderId, this.addRemoteVideoElement, this.addLocalVideoElement)
              .then(_ => {})
          } else {
            this.wsMessages.push(message)
          }
        } catch (e) {
          console.log(e)
          this.wsMessages.push(message)
        }
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
    if (this.dataChannelSvc.dataChannel.readyState === 'open') {
      const msg = text || this.message
      await this.dataChannelSvc.sendMsg(msg)
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
    this.dataChannelSvc = new DataChannelRTCService(this.websocketSvc, this.roomInfo)
    // init video call service
    this.videoCallSvc = new WebRTCService(this.websocketSvc,this.roomInfo)
    // create data channel
    const context = this
    this.dataChannelSvc.setupDataChannelConnections(context, this.startVideoCallBack, this.pushMessageDatachannelCallback)
      .then(() => {})
  }

  // WebRTC methods for media streaming

  toggleVideoCall(event: any) {
    this.isChecked = event.target.checked
    if (this.videoCallSvc.onCall) {
      this.videoCallSvc.toggleMediaCall(this.isChecked, this.addLocalVideoElement).then()
    }
  }

  /*=============================CALL BACKS==============================================*/

  pushMessageDatachannelCallback(context: any, msg: string) {
    context.listMessage.push('Peer: ' + msg)
    context.cdr.detectChanges()
  }

  /**
   * Callback start video call when data-channel send command 'video'
   * @param context `this` pointer
   * @param from from userId
   */
  async startVideoCallBack(context: any, from: string) {
    context.videoCallSvc.startVideoCall(from, context.addRemoteVideoElement, context.addLocalVideoElement).then()
  }

  /**
   * callback Ui
   * @param stream remote video
   * @param sid userId
   */
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

  /**
   * callback Ui
   * @param stream remote video
   * @param sid userId
   */
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
