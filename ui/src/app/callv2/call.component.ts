import {AfterViewInit, Component, ElementRef, OnInit, ViewChild, ViewEncapsulation} from '@angular/core';
import {ActivatedRoute} from '@angular/router';
import {NgClass, NgForOf, NgIf} from '@angular/common';
import {FormsModule} from '@angular/forms';
import {HomeComponent} from '../home/home.component';
import {
  DataChannelService,
  VideoChannelService,
} from 'webrtc-common';
import {environment} from '../../environments/environment';

@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  imports: [
    NgForOf,
    NgIf,
    FormsModule,
    NgClass
  ],
  styleUrls: ['./call.component.css'],
  encapsulation: ViewEncapsulation.None
})
export class CallComponentV2 implements OnInit, AfterViewInit {

  // ----------------- Khởi tạo & Lifecycle -----------------
  constructor(private readonly route: ActivatedRoute) {}
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  remoteUsers: string[] = ['user1', 'user2']; // dummy IDs
  isMinimized = false;

  roomId = '';
  joinLink = ''
  sid = '';
  isMaster = 'false'

  chatOpen = false;
  newMessage = '';
  messages: { text: string; from: string }[] = [];
  dataChannelSvc: DataChannelService
  videoChannelSvc!: VideoChannelService;
  remoteStreams: { [userId: string]: MediaStream } = {};

//   Toast
  showToast = false;
  toastMessage = 'Do you want to continue?';

/* Toast dialog */
  private toastYesCallback: (() => void) | null = null;

  ngOnInit(): void {
    this.roomId = this.route.snapshot.paramMap.get('roomId') || '';
    this.sid = this.route.snapshot.paramMap.get('sid') || '';
    if (!this.sid) {
      this.sid = HomeComponent.randomName()
      console.log(`auto gen username: ${this.sid}`)
    }
    const isMasterParam = this.route.snapshot.paramMap.get('isMaster');
    const isMasterQuery = this.route.snapshot.queryParamMap.get('isMaster');
    this.isMaster = isMasterParam ?? isMasterQuery ?? 'false';
    this.joinLink = `${window.location.origin}/webrtc-v2/${this.roomId}`;
    console.log('Room ID:', this.roomId);
    console.log('Session/User ID (sid):', this.sid);
  }

  ngAfterViewInit() {
    this.initDataChannel()
  }

  // eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
  // noinspection JSUnusedGlobalSymbols
  ngOnDestroy(): void {
    this.dataChannelSvc.onDestroy()
  }

  // ----------------- WebRTC & Signaling ------------------
  private initDataChannel() {
    if (this.dataChannelSvc == null) {
      // isMaster = true:  (#0) A tạo room ID=1234 và chờ người khác join
      // isMaster = false: (#1) B Yêu cầu join room 1234
      this.dataChannelSvc = new DataChannelService(
        this.sid,
        this.roomId,
        this.isMaster === 'true',
        environment.socket
      )
      // Push message datachannel lên giao diện (UI controller)
      this.dataChannelSvc.addOnMessageEventListener((msg, sender) => {
        this.messages.push({ text: msg, from: sender });
        setTimeout(() => this.scrollToBottom(), 100);
      });
      // Set toast confirm when new user request join chat: (optional)
      this.dataChannelSvc.setToastConfirmJoinRoomCallBack(
        this.showConfirmToast.bind(this)
      );
    }
  }

  private initVideoChannel() {
    if (!this.videoChannelSvc) {
      this.videoChannelSvc = new VideoChannelService(
        this.sid,
        this.roomId,
        null,
        environment.socket
      );
    }
    // insert video element khi có remote stream connected
    this.videoChannelSvc.addOnRemoteStreamListener((stream, from) => {
      this.remoteStreams[from] = stream;
      this.remoteVideoHtmlCallback(from, stream);
    });
  }

  private remoteVideoHtmlCallback(from: string, stream: MediaStream) {
    let videoEl = document.getElementById('video-' + from) as HTMLVideoElement;
    if (!videoEl) {
      const grid = document.querySelector('.participant-grid');
      if (grid) {
        // Tạo div tile
        const tileDiv = document.createElement('div');
        tileDiv.className = 'tile';

        // Tạo video element
        videoEl = document.createElement('video');
        videoEl.id = 'video-' + from;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.className = 'dynamic-video'; // Thêm class

        // Thêm video vào tile, tile vào grid
        tileDiv.appendChild(videoEl);
        grid.appendChild(tileDiv);
      }
    }
    videoEl.srcObject = stream;
  }

// ----------------- Điều khiển Media --------------------
  private async enableMedia() {
    this.initVideoChannel();
    let stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    this.localVideo.nativeElement.srcObject = stream;
    await this.videoChannelSvc.setLocalStream(stream);
  }

  hangUp() {
    if (this.videoChannelSvc.getLocalStream()) {
      this.videoChannelSvc.getLocalStream().getTracks().forEach(track => track.stop());
    }
  }

  toggleCamera() {
    if (!this.videoChannelSvc?.getLocalStream()) return this.enableMedia();
    const videoTrack = this.videoChannelSvc.getLocalStream().getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
  }

  toggleMic() {
    if (!this.videoChannelSvc.getLocalStream()) return this.enableMedia();
    const audioTrack = this.videoChannelSvc.getLocalStream().getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
  }

  // ----------------- Data Channel Chat -------------------
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

    // Send to other peers via signaling or WebRTC data channel
    // this.sendToPeers(this.newMessage);
    this.dataChannelSvc.sendMsg(this.newMessage).then(
      _ => {
        // Add local message
        this.messages.push({ text: this.newMessage, from: 'me' });
        this.newMessage = '';
        setTimeout(() => this.scrollToBottom(), 100);
      }
    )
  }

  clearChat() {
    this.messages = [];
  }

  scrollToBottom() {
    const el = document.querySelector('.chat-messages');
    if (el) el.scrollTop = el.scrollHeight;
  }

  // ----------------- UI & Toast -------------------------
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

  goHome() {
    window.location.href = '/'
  }

  // ----------------- Thuộc tính -------------------------
  // ...các thuộc tính class...
  showConfirmToast(message: string, onYes: () => void) {
    this.toastMessage = message;
    this.toastYesCallback = onYes;
    this.showToast = true;
  }

  onToastYes() {
    this.showToast = false;
    if (this.toastYesCallback) {
      this.toastYesCallback();  // Gọi callback khi người dùng ấn Yes
      this.toastYesCallback = null; // Xoá callback sau khi dùng
    }
  }

  onToastNo() {
    this.showToast = false;
    this.toastYesCallback = null;
  }

  // eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
  // noinspection JSUnusedGlobalSymbols
  ngAfterViewChecked(): void {
    // Gán lại srcObject cho tất cả video remote
    this.remoteUsers.forEach(user => {
      const videoEl = document.getElementById('video-' + user) as HTMLVideoElement;
      if (videoEl && this.remoteStreams[user] && videoEl.srcObject !== this.remoteStreams[user]) {
        videoEl.srcObject = this.remoteStreams[user];
      }
    });
  }
}
