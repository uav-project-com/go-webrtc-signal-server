import {Component, ElementRef, OnInit, ViewChild} from '@angular/core';
import {ActivatedRoute} from '@angular/router';

@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponentV2 implements OnInit {
  isDisplay = false
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  remoteUsers: string[] = ['user1', 'user2']; // dummy IDs
  isMinimized = false;
  stream!: MediaStream;

  roomId = '';
  sid = '';
  constructor(private route: ActivatedRoute) {}

  ngOnInit(): void {
    this.roomId = this.route.snapshot.paramMap.get('roomId') || '';
    this.sid = this.route.snapshot.paramMap.get('sid') || '';
    console.log('Room ID:', this.roomId);
    console.log('Session/User ID (sid):', this.sid);
  }

  async ngAfterViewInit() {
    // Initially do not access media — wait for user interaction
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
    navigator.clipboard.writeText('https://meet.google.com/umq-eigo-xsh').then(_ => {});
  }

  shareInvite() {
    window.open('mailto:?subject=Join my meeting&body=Click to join: https://meet.google.com/umq-eigo-xsh');
  }

  minimizeSelf() {
    this.isMinimized = true;
  }

  restoreSelf() {
    this.isMinimized = false;
  }

  openEmoji() {
    alert('Emoji menu coming soon!');
  }

  openMoreOptions() {
    alert('More options coming soon!');
  }

  hangUp() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}
