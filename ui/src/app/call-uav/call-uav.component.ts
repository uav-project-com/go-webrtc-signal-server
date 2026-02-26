import { AfterViewInit, Component, ElementRef, OnInit, ViewChild, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { HomeComponent } from '../home/home.component';
import { DataChannelService, VideoChannelService, VideoElementUtil, } from 'webrtc-common';
import { environment } from '../../environments/environment';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule, NzIconService } from 'ng-zorro-antd/icon';
import { NzToolTipModule } from 'ng-zorro-antd/tooltip';
import { ReloadOutline, PoweroffOutline, MoreOutline } from '@ant-design/icons-angular/icons';

@Component({
  selector: 'app-call',
  templateUrl: './call-uav.component.html',
  imports: [
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzToolTipModule
  ],
  styleUrls: ['./call-uav.component.scss'],
  encapsulation: ViewEncapsulation.None
})
export class CallUavComponent implements OnInit, AfterViewInit {

  // ----------------- Khởi tạo & Lifecycle -----------------
  constructor(private readonly route: ActivatedRoute, private iconService: NzIconService) {
    this.iconService.addIcon(ReloadOutline, PoweroffOutline, MoreOutline);
  }
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  remoteUsers: string[] = ['user1', 'user2']; // dummy IDs
  isMinimized = false;

  roomId = '';
  sid = '';
  isMaster = 'false'

  chatOpen = false;
  newMessage = '';
  dataChannelSvc: DataChannelService
  videoChannelSvc!: VideoChannelService;
  remoteStreams: { [userId: string]: MediaStream } = {};

  ngOnInit(): void {
    this.roomId = '888-888-888'
    this.sid = this.route.snapshot.paramMap.get('sid') || '';
    if (!this.sid) {
      this.sid = HomeComponent.randomName()
      console.log(`auto gen username: ${this.sid}`)
    }
    this.isMaster = 'false';
    console.log('Room ID:', this.roomId);
    console.log('Session/User ID (sid):', this.sid);
  }

  ngAfterViewInit() {
    this.initDataChannel();
    // Auto-start video after a delay to ensure clean init and avoid race conditions
    setTimeout(() => {
      console.log('Auto-starting UAV camera...');
      this.toggleCamera();
    }, 3000);
  }

  // eslint-disable-next-line @angular-eslint/no-empty-lifecycle-method
  // noinspection JSUnusedGlobalSymbols
  ngOnDestroy(): void {
    this.dataChannelSvc.onDestroy()
  }

  // ================================== WebRTC & Signaling ===============================================================
  private initDataChannel() { // Converted
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
        console.log(`received: ${msg} from ${sender}`)
      });
    }
  }

  private async initVideoChannel() {
    if (!this.videoChannelSvc) {
      this.videoChannelSvc = new VideoChannelService(
        this.sid,
        this.roomId,
        null,
        environment.socket,
        null,
        this.dataChannelSvc
      );
      // init html control elements
      await VideoElementUtil.initControls(
        this.videoChannelSvc,
        this.localVideo.nativeElement,
        this.remoteStreams,
        this.remoteUsers,
        environment.enableLocalVideo,
        environment.enableLocalAudio
      ).then()
    }
  }

  // ----------------- Điều khiển Media ----------------------------------------------------------------------

  toggleCamera() {
    if (!this.videoChannelSvc) {
      this.initVideoChannel().then()
    }
    this.videoChannelSvc.toggleLocalVideo()
  }

  // ----------------- Data Channel Chat -----------------------------------------------------------------------
  // todo: does we need that func? because we just F5 to refresh connection
  toggleChat() {
    this.initDataChannel()
    this.chatOpen = !this.chatOpen;
  }
  openMoreOptions() { }

  /**
   * Chat example via data-channel
   */

  sendMessage() {
    if (!this.newMessage.trim()) return;

    // Send to other peers via signaling or WebRTC data channel
    // this.sendToPeers(this.newMessage);
    this.dataChannelSvc.sendMsg(this.newMessage).then(
      _ => {
      }
    )
  }


  // ----------------- UI & Toast ------------------------------------------------------------------------------
  goHome() {
    window.location.href = '/'
  }

  // ----------------- Thuộc tính -------------------------
  // ...các thuộc tính class...

  restart() {
    window.location.reload();
  }

  powerOff() {
    if (this.videoChannelSvc) {
      this.videoChannelSvc.hangUp();
    }
    this.goHome();
  }
}
