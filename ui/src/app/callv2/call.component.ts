import { Component, ElementRef, ViewChild } from '@angular/core';

@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponentV2 {
  @ViewChild('localVideo') localVideo!: ElementRef<HTMLVideoElement>;
  @ViewChild('remoteVideo') remoteVideo!: ElementRef<HTMLVideoElement>;

  async ngAfterViewInit() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.localVideo.nativeElement.srcObject = stream;
    } catch (err) {
      console.error('Error accessing media devices.', err);
    }
  }

  copyLink() {
    navigator.clipboard.writeText('https://meet.google.com/umq-eigo-xsh');
  }

  shareInvite() {
    window.open('mailto:?subject=Join my meeting&body=Click to join: https://meet.google.com/umq-eigo-xsh');
  }

  toggleCamera() {
    const stream = this.localVideo.nativeElement.srcObject as MediaStream;
    const videoTrack = stream.getVideoTracks()[0];
    videoTrack.enabled = !videoTrack.enabled;
  }

  toggleMic() {
    const stream = this.localVideo.nativeElement.srcObject as MediaStream;
    const audioTrack = stream.getAudioTracks()[0];
    audioTrack.enabled = !audioTrack.enabled;
  }

  openEmoji() {
    alert('Emoji menu coming soon!');
  }

  openMoreOptions() {
    alert('More options here');
  }

  hangUp() {
    const stream = this.localVideo.nativeElement.srcObject as MediaStream;
    stream.getTracks().forEach(track => track.stop());
    // Add redirect or hangup logic
  }
}
