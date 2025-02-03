import {Component, OnInit} from '@angular/core';
import {HttpClient} from '@angular/common/http';
import {Sdp} from './Sdp';
import {ActivatedRoute} from "@angular/router";

@Component({
  selector: 'app-call',
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {

  pcSender: any
  pcReceiver: any
  meetingId: string
  peerID: string
  userId: string
  URL = "/api/v1/webrtc/start-call"

  constructor(private http: HttpClient, private route: ActivatedRoute) {
  }


  ngOnInit() {
    // use http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get("meetingId");
    this.peerID = this.route.snapshot.paramMap.get("peerID");
    this.userId = this.route.snapshot.paramMap.get("userId")

    this.pcSender = new RTCPeerConnection({
      iceServers: [
        {urls: "stun:stun.l.google.com:19302"},
        {urls: "stun:stun.l.google.com:5349"},
        {urls: "stun:stun1.l.google.com:3478"},
        {urls: "stun:stun1.l.google.com:5349"},
        {urls: "stun:stun2.l.google.com:19302"},
        {urls: "stun:stun2.l.google.com:5349"},
        {urls: "stun:stun3.l.google.com:3478"},
        {urls: "stun:stun3.l.google.com:5349"},
        {urls: "stun:stun4.l.google.com:19302"},
        {urls: "stun:stun4.l.google.com:5349"}
      ]
    })
    this.pcReceiver = new RTCPeerConnection({
      iceServers: [
        {urls: "stun:stun.l.google.com:19302"},
        {urls: "stun:stun.l.google.com:5349"},
        {urls: "stun:stun1.l.google.com:3478"},
        {urls: "stun:stun1.l.google.com:5349"},
        {urls: "stun:stun2.l.google.com:19302"},
        {urls: "stun:stun2.l.google.com:5349"},
        {urls: "stun:stun3.l.google.com:3478"},
        {urls: "stun:stun3.l.google.com:5349"},
        {urls: "stun:stun4.l.google.com:19302"},
        {urls: "stun:stun4.l.google.com:5349"}
      ]
    })

    this.pcSender.onicecandidate = (event: { candidate: null; }) => {
      if (event.candidate === null) {
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/' + this.meetingId + "/c/" + this.userId + "/p/" + this.peerID + "/s/" + true,
          {"sdp": btoa(JSON.stringify(this.pcSender.localDescription))}).subscribe(response => {
          this.pcSender.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))))
        });
      }
    }
    this.pcReceiver.onicecandidate = (event: { candidate: null; }) => {
      if (event.candidate === null) {
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/' + this.meetingId + "/c/" + this.userId + "/p/" + this.peerID + "/s/" + false,
          {"sdp": btoa(JSON.stringify(this.pcReceiver.localDescription))}).subscribe(response => {
          this.pcReceiver.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))))
        })
      }
    }
  }

  startCall() {
    // sender part of the call
    navigator.mediaDevices.getUserMedia({video: true, audio: true}).then((stream) => {
      const senderVideo: any = document.getElementById('senderVideo');
      senderVideo.srcObject = stream;
      const tracks = stream.getTracks();
      for (let i = 0; i < tracks.length; i++) {
        this.pcSender.addTrack(stream.getTracks()[i]);
      }
      this.pcSender.createOffer().then(d => {
        this.pcSender.setLocalDescription(d)
      })
    })
    // you can use event listner so that you inform he is connected!
    this.pcSender.addEventListener('connectionstatechange', event => {
      console.log("connectionstatechange-state:" + this.pcSender.connectionState)
      if (this.pcSender.connectionState === 'connected') {
        console.log("horray!")
      }
    });

    // receiver part of the call
    this.pcReceiver.addTransceiver('video', {'direction': 'recvonly'})

    this.pcReceiver.createOffer()
      .then((d: any) => {
        this.pcReceiver.setLocalDescription(d)
      })

    this.pcReceiver.ontrack = function (event: { streams: any[]; }) {
      const receiverVideo: any = document.getElementById('receiverVideo');
      receiverVideo.srcObject = event.streams[0]
      receiverVideo.autoplay = true
      receiverVideo.controls = true
    }

  }

}
