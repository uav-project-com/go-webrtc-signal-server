import {Component, OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Sdp} from './Sdp';
import {ActivatedRoute} from '@angular/router';
import {FormsModule} from '@angular/forms';

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {

  pcSender: any
  pcReceiver: any
  dataChannel!: RTCDataChannel;
  meetingId: string
  peerID: string
  userId: string
  message: string
  receivedMessages: string[] = [];

  constructor(private http: HttpClient, private route: ActivatedRoute) {
  }


  ngOnInit() {
    // use http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId');
    this.peerID = this.route.snapshot.paramMap.get('peerID');
    this.userId = this.route.snapshot.paramMap.get('userId')

    this.pcSender = new RTCPeerConnection({
      iceServers: [
        {urls: 'stun:stun.l.google.com:19302'},
      ]
    })
    this.pcReceiver = new RTCPeerConnection({
      iceServers: [
        {urls: 'stun:stun.l.google.com:19302'},
      ]
    })

    // create data channel
    this.dataChannel = this.pcSender.createDataChannel('chat')
    this.dataChannel.onopen = () => console.log('Data channel open');
    this.dataChannel.onmessage = (event) => {
      console.log('Received:', event.data);
      this.receivedMessages.push('Peer: ' + event.data);
    };
    // When pcReceiver gets a data channel
    this.pcReceiver.ondatachannel = (event) => {
      const receiveChannel = event.channel;
      receiveChannel.onmessage = (e) => {
        console.log('Received:', e.data);
        this.receivedMessages.push('You: ' + e.data);
      };
    };

    this.pcSender.onicecandidate = (event: { candidate: null; }) => {
      if (event.candidate === null) {
        console.log(new Date() + ' sender http.post')
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/'
          + this.meetingId + '/c/' + this.userId + '/p/' + this.peerID + '/s/' + true,
          {sdp: btoa(JSON.stringify(this.pcSender.localDescription))}).subscribe(response => {
          this.pcSender.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))))
        });
      }
    }
    this.pcReceiver.onicecandidate = (event: { candidate: null; }) => {
      if (event.candidate === null) {
        console.log(new Date() + ' receiver http.post')
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/'
          + this.meetingId + '/c/' + this.userId + '/p/' + this.peerID + '/s/' + false,
          {sdp: btoa(JSON.stringify(this.pcReceiver.localDescription))}).subscribe(response => {
          this.pcReceiver.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))))
        })
      }
    }
  }

  startCall() {
    // sender part of the call
    const isAlice = this.userId === 'alice'
    if (isAlice) {
      navigator.mediaDevices.getUserMedia({video: true, audio: false}).then((stream) => {
        const senderVideo: any = document.getElementById('senderVideo');
        senderVideo.srcObject = stream;
        const tracks = stream.getTracks();
        for (let i = 0; i < tracks.length; i++) {
          this.pcSender.addTrack(stream.getTracks()[i]);
        }
        this.pcSender.createOffer().then(d => {
          this.pcSender.setLocalDescription(d)
          console.log(new Date() + ' pcSender.createOffer')
        })
      })
    }
    // you can use event listner so that you inform he is connected!
    this.pcSender.addEventListener('connectionstatechange', _event => {
      console.log('connectionstatechange-state:' + this.pcSender.connectionState)
      if (this.pcSender.connectionState === 'connected') {
        console.log('horray!')
      }
    });

    // receiver part of the call
    this.pcReceiver.addTransceiver('video', {direction: 'recvonly'})

    this.pcReceiver.createOffer()
      .then((d: any) => {
        this.pcReceiver.setLocalDescription(d)
        console.log(new Date() + ' pcReceiver.createOffer')
      })

    this.pcReceiver.ontrack = (event: { streams: any[]; }) => {
      const receiverVideo: any = document.getElementById('receiverVideo');
      receiverVideo.srcObject = event.streams[0]
      receiverVideo.autoplay = true
      receiverVideo.controls = true
    }

  }

  sendMsg() {
    if (this.dataChannel.readyState === 'open') {
      console.log('Sending: ' + this.message)
      this.dataChannel.send(this.message);
      this.receivedMessages.push('You: ' + this.message);
      this.message = '';
    }
  }
}
