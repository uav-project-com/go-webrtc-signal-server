import { Component, OnInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Sdp } from './Sdp';
import { ActivatedRoute } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ChangeDetectorRef } from '@angular/core';
import { Message } from './Message';
import { Subscription } from 'rxjs';
import { WebsocketService } from './websocket.service';

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {

  pcSender: any
  pcReceiver: any
  data2WaySender: any
  dataChannel: RTCDataChannel | null = null;

  meetingId: string
  peerID: string
  userId: string
  message: string
  receivedMessages: string[] = [];
  /** FOR WebSocket */
  websocketMess: string
  wsMessages: Message[] = [];
  private msgSubscription: Subscription | null = null;


  constructor(
    private http: HttpClient,
    private route: ActivatedRoute,
    private cdr: ChangeDetectorRef,
    private websocketSvc: WebsocketService) {
  }


  ngOnInit() {
    // INIT WebRTC
  
    // use http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://localhost:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId');
    this.peerID = this.route.snapshot.paramMap.get('peerID');
    this.userId = this.route.snapshot.paramMap.get('userId')

    const config: RTCConfiguration = {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    };

    // video is one-way, each connection is independent and works separately: { direction: 'recvonly' }
    this.pcSender = new RTCPeerConnection(config)
    this.pcReceiver = new RTCPeerConnection(config)
    // Unlike video, DataChannel requires a bidirectional connection:
    this.data2WaySender = new RTCPeerConnection(config)

    // create data channel
    this.setupDataConnections();
    // setup video connection
    this.setupVideoConnections();
  }

  ngOnDestroy(): void {
    this.msgSubscription?.unsubscribe();
    this.websocketSvc.close();
  }

  connectWebsocket() {
    // INIT WebSocket - Auto connect to server
    this.websocketSvc.connect(this.meetingId, this.userId);
    this.msgSubscription = this.websocketSvc.getMessages().subscribe((message) => {
      if (message && !message.status) { // received message from peers
        console.log(`Received msg from ${message.from}: ${message.msg}`)
        this.wsMessages.push(message);
      } else if (message && message.status) { // response msg from websocket server
        console.log(`response: ${message.status} ${message.msg}`)
      }
    });
  }

  startCall() {
    // creating webrtc datachannel connection
    this.data2WaySender.createOffer().then((d: any) => {
      this.data2WaySender.setLocalDescription(d)
      console.log(new Date() + ' data2WaySender.createOffer')
    })
    this.data2WaySender.addEventListener('connectionstatechange', _event => {
      console.log('connectionstatechange-state:' + this.data2WaySender.connectionState)
      if (this.data2WaySender.connectionState === 'connected') {
        console.log('datachannel connected!')
      }
    });

    // sender part of the call
    navigator.mediaDevices.getUserMedia({ video: true, audio: false }).then((stream) => {
      const senderVideo: any = document.getElementById('senderVideo');
      senderVideo.srcObject = stream;
      const tracks = stream.getTracks();
      for (let i = 0; i < tracks.length; i++) {
        this.pcSender.addTrack(stream.getTracks()[i]);
      }
      this.pcSender.createOffer().then((d: any) => {
        this.pcSender.setLocalDescription(d)
        console.log(new Date() + ' pcSender.createOffer')
      })
    })
    // you can use event listner so that you inform he is connected!
    this.pcSender.addEventListener('connectionstatechange', _event => {
      console.log('connectionstatechange-state:' + this.pcSender.connectionState)
      if (this.pcSender.connectionState === 'connected') {
        console.log('horray!')
      }
    });

    // receiver part of the call
    this.pcReceiver.addTransceiver('video', { direction: 'recvonly' })

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

  async sendMsg() {
    if (this.dataChannel.readyState === 'open') {
      console.log('Sending: ' + this.message)
      this.dataChannel.send(this.message);
      this.receivedMessages.push('You: ' + this.message);
      this.message = '';
      // Manually trigger change detection
      this.cdr.detectChanges();
    }
  }

  private setupVideoConnections() {
    this.data2WaySender.onicecandidate = (event) => {
      if (event.candidate) {
        // Send ICE candidate to remote peer via HTTP signaling
        this.http.post('http://127.0.0.1:8080/webrtc/candidate/m/' 
          + this.meetingId + '/c/' + this.userId + '/p/' + this.peerID,
          { candidate: btoa(JSON.stringify(event.candidate)) }).subscribe();
      }
    };
    
    // Once ICE gathering is complete, send SDP offer
    this.data2WaySender.onicegatheringstatechange = () => {
      if (this.data2WaySender.iceGatheringState === "complete") {
        console.log(new Date() + " data2WaySender HTTP POST SDP");
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/'
          + this.meetingId + '/c/' + this.userId + '/p/' + this.peerID,
          { sdp: btoa(JSON.stringify(this.data2WaySender.localDescription)) })
          .subscribe(response => {
            this.data2WaySender.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))));
          });
      }
    };
    

    this.pcSender.onicecandidate = (event: { candidate: null; }) => {
      if (event.candidate === null) {
        console.log(new Date() + ' sender http.post')
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/'
          + this.meetingId + '/c/' + this.userId + '/p/' + this.peerID + '/s/' + true,
          { sdp: btoa(JSON.stringify(this.pcSender.localDescription)) }).subscribe(response => {
            this.pcSender.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))))
          });
      }
    }
    this.pcReceiver.onicecandidate = (event: { candidate: null; }) => {
      if (event.candidate === null) {
        console.log(new Date() + ' receiver http.post')
        this.http.post<Sdp>('http://127.0.0.1:8080/webrtc/sdp/m/'
          + this.meetingId + '/c/' + this.userId + '/p/' + this.peerID + '/s/' + false,
          { sdp: btoa(JSON.stringify(this.pcReceiver.localDescription)) }).subscribe(response => {
            this.pcReceiver.setRemoteDescription(new RTCSessionDescription(JSON.parse(atob(response.Sdp))))
          })
      }
    }
  }

  private setupDataConnections() {
    // must init before create channel for listen event of create channel `chat`
    this.data2WaySender.ondatachannel = (event) => {
      console.log("Data channel received on receiver");
      this.dataChannel = event.channel; // Store the data channel reference

      this.dataChannel.onmessage = (messageEvent) => {
        console.log("Received message from sender:", messageEvent.data);
        this.receivedMessages.push("Peer: " + messageEvent.data);
        this.cdr.detectChanges();
      };

      this.dataChannel.onopen = () => console.log("Receiver data channel is open");
    };

    // Create sender's data channel
    this.dataChannel = this.data2WaySender.createDataChannel("chat");

    this.dataChannel.onopen = () => console.log("Data channel opened!");
    this.dataChannel.onmessage = (event) => {
      console.log("Received message:", event.data);
      this.receivedMessages.push("You: " + event.data);
      this.cdr.detectChanges();
    };
  }

  /***************************** WebSocket Functions *******************************/
  sendWsMessage() {
    const data : Message = {
      from: this.userId,
      to: this.peerID,
      msg: this.websocketMess,
      roomId: this.meetingId
    }

    this.websocketSvc.sendMessage(data);
    this.wsMessages.push(data)
  }
}
