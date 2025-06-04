import {Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {NgClass, NgForOf, NgIf} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {DataChannelService, REQUEST_JOIN_DATA_CHANNEL, REQUEST_JOIN_MEDIA_CHANNEL} from 'webrtc-common';
import {WebsocketService} from '../common/websocket.service';
import {Subscription} from 'rxjs';
import {Channel, SignalMsg} from 'webrtc-common/dist/dto/SignalMsg';

@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  imports: [
    NgForOf,
    NgIf,
    FormsModule,
    NgClass
  ],
  styleUrls: ['./call.component.css']
})
export class CallComponentV2 implements OnInit {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  remoteUsers: string[] = ['user1', 'user2']; // dummy IDs
  isMinimized = false;
  stream!: MediaStream;

  roomId = '';
  joinLink = ''
  sid = '';
  isJoiner = false

  chatOpen = false;
  newMessage = '';
  messages: { text: string; from: string }[] = [];
  msgSubscription: Subscription | null = null
  dataChannelSvc: DataChannelService

  constructor(private route: ActivatedRoute, private websocketSvc: WebsocketService) {

  }

  ngOnInit(): void {
    this.roomId = this.route.snapshot.paramMap.get('roomId') || '';
    this.sid = this.route.snapshot.paramMap.get('sid') || '';
    this.joinLink = `${window.location.origin}/${this.roomId}`;
    this.isJoiner = Boolean(this.route.snapshot.paramMap.get('isJoiner') || false);
    console.log('Room ID:', this.roomId);
    console.log('Session/User ID (sid):', this.sid);
    // init websocket signaling client
    this.websocketSvc.connect(this.roomId, this.sid)
    this.msgSubscription = this.websocketSvc.getMessages().subscribe(async (message) => {
      console.log(`received ws: ${JSON.stringify(message)}`)
      if (message && message.status === 200 && message.msg.startsWith('onConnected')) {
        // auto init data-channel for chat in real life logic
        this.initDataChannel()
      } else {
        this.handlerMessage(message)
      }
    })
  }

  async ngAfterViewInit() {
    // Initially do not access media — wait for user interaction
  }

  ngOnDestroy(): void {
    this.msgSubscription?.unsubscribe()
    this.websocketSvc.close()
  }

  async enableMedia() {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    this.localVideo.nativeElement.srcObject = this.stream;
  }

  toggleCamera() {
    if (!this.stream) return this.enableMedia();
    const videoTrack = this.stream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
  }

  toggleMic() {
    if (!this.stream) return this.enableMedia();
    const audioTrack = this.stream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
  }

  copyLink() {
    navigator.clipboard.writeText(this.joinLink).then(_ => {});
  }

  shareInvite() {
    window.open('mailto:?subject=Join my meeting&body=Click to join: ' + this.joinLink);
  }

  minimizeSelf() {
    this.isMinimized = true;
  }

  restoreSelf() {
    this.isMinimized = false;
  }

  openMoreOptions() {
    alert('More options coming soon!');
  }

  hangUp() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }

  // Data channel chat
  toggleChat() {
    this.initDataChannel()
    this.chatOpen = !this.chatOpen;
  }

  /**
   * Chat example via data-channel
   */
  openChat() {
    this.chatOpen = true;
  }

  sendMessage() {
    if (!this.newMessage.trim()) return;

    // Add local message
    this.messages.push({ text: this.newMessage, from: 'me' });

    // Send to other peers via signaling or WebRTC data channel
    // this.sendToPeers(this.newMessage);
    this.dataChannelSvc.sendMsg(this.newMessage).then()

    this.newMessage = '';
    setTimeout(() => this.scrollToBottom(), 100);
  }

  clearChat() {
    this.messages = [];
  }

  scrollToBottom() {
    const el = document.querySelector('.chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  initDataChannel() {
    if (this.dataChannelSvc == null) {
      this.dataChannelSvc = new DataChannelService(
        this.sid,
        this.roomId,
        this.websocketSvc.send
      )
      // sending broadcast request to join data-channel
      if (this.isJoiner) {
        const msg: SignalMsg = {
          msg: REQUEST_JOIN_DATA_CHANNEL,
          roomId: this.roomId,
          from: this.sid,
        }
        this.websocketSvc.send(msg)
      }
    }
  }

  isSignalMsg(obj: any): obj is SignalMsg {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      typeof obj.from === 'string' &&
      'msg' in obj
    )
  }


  handlerMessage(message: any) {
    if (this.isSignalMsg(message)) {
      this.handlerSignalMessage(message)
    }
  }

  /**
   * Process signaling messages exchange for webrtc
   * @param message signaling message
   */
  handlerSignalMessage(message: SignalMsg) {
    switch (message.msg) {
      case REQUEST_JOIN_DATA_CHANNEL:
        this.dataChannelSvc.createDataChannelConnection(this.sid, true).then()
        break
      case REQUEST_JOIN_MEDIA_CHANNEL:
        // TODO implement it
        break
      default:
        // handling webrtc message signaling events
        if (message.channel && message.channel === Channel.DataRtc) {
          this.dataChannelSvc.handleSignalingData(message).then()
        } else if (message.channel && message.channel === Channel.Webrtc) {
          // TODO implement it
        }
    }
  }
}
