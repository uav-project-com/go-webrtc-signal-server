import {Component, OnInit} from '@angular/core'
import {ActivatedRoute} from '@angular/router'
import {FormsModule} from '@angular/forms'
import {Message} from './Message'
import {Subscription} from 'rxjs'
import {WebsocketService} from './websocket.service'

const ENABLE_LOCAL_VIDEO = false

@Component({
  selector: 'app-call',
  imports: [FormsModule],
  templateUrl: './call.component.html',
  styleUrls: ['./call.component.css']
})
export class CallComponent implements OnInit {
  static count = 0
  meetingId: string
  peerId: string
  userId: string
  message: string
  listMessage: string[] = []
  /** FOR WebSocket */
  websocketMess: string
  wsMessages: Message[] = []
  private msgSubscription: Subscription | null = null

  // list peerConnection: create new element for each peerId (not my userId)
  peers = {}
  pendingCandidates = {}
  localStream: MediaStream
  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }

  constructor(
    private route: ActivatedRoute,
    private websocketSvc: WebsocketService) {
  }

  ngOnInit() {
    // use http://192.168.20.191:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=alice;peerID=bob
    // and http://192.168.20.191:4200/call;meetingId=07927fc8-af0a-11ea-b338-064f26a5f90a;userId=bob;peerID=alice
    // start the call
    this.meetingId = this.route.snapshot.paramMap.get('meetingId')
    this.peerId = this.route.snapshot.paramMap.get('peerID')
    this.userId = this.route.snapshot.paramMap.get('userId')
  }

  ngOnDestroy(): void {
    try {
      this.hangup()
      this.msgSubscription?.unsubscribe()
      this.websocketSvc.close()
    } catch (_e) {
    }
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
        this.handleSignalingData(message).then()
      } else if (message && message.status) { // response msg from websocket server
        console.log(`response: ${JSON.stringify(message)}`)
        if (message.status === 200 && message.msg.startsWith('onConnected')) {
          console.log('====-Websocket connected! Start to data-channel connection-===')
          // websocket is ok now, start to call Webrtc
          this.startControlUav().then()
        }
      }
    })
  }

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   */
  public async startControlUav() {
    await this.init().then(async () => {
      await this.call()
    })
  }


  private onAddStream(event: any) {
    console.log("ontrack")
    const newRemoteStreamElem = document.createElement('video')
    newRemoteStreamElem.autoplay = true
    newRemoteStreamElem.srcObject = event.streams[0]
    newRemoteStreamElem.playsInline = true
    document.querySelector('#remoteStreams').appendChild(newRemoteStreamElem)
  }

  private async init() {
    // init
    this.peers[this.peerId] = new RTCPeerConnection(this.config)
    this.peers[this.peerId].ontrack = this.onAddStream
    // add track
    if (this.userId === 'alice') // alice stream sent to bob
      await navigator.mediaDevices.getUserMedia({video: true, audio: false}).then(stream => {
        console.log('Stream found');
        this.localStream = stream;
        if (ENABLE_LOCAL_VIDEO) {
          // Attach the local stream to the video element
          const localVideo: any = document.getElementById('localVideo');
          if (localVideo) {
            localVideo.srcObject = this.localStream;
          }
        }

        // add track
        this.peers[this.peerId].addTrack(stream.getTracks()[0], stream);

      });
    // setting on-candidate event
    this.peers[this.peerId].onicecandidate = (e: any) => {
      console.log("ICE Candidate Event Triggered:", e.candidate)
      if (e.candidate) {
        // sending offer to other peers (broadcast)
        this.websocketSvc.sendMessage({
          from: this.userId,
          roomId: this.meetingId,
          msg: btoa(JSON.stringify({sdp: e.candidate}))
        })
      }
    }
  }

  private async call() {
    // The caller creates an offer and sets it as its local description before sending it to the remote peer via WebSocket.
    let offer = await this.peers[this.peerId].createOffer();
    await this.peers[this.peerId].setLocalDescription(offer);
    // sending offer to other peers (broadcast)
    this.websocketSvc.sendMessage({
      from: this.userId,
      roomId: this.meetingId,
      msg: btoa(JSON.stringify({sdp: offer}))
    })
    // adding to pending candidate list
    await this.addPendingCandidates(this.peerId)
  }

  hangup() {
    this.peers[this.peerId].close();
  }

  private addPendingCandidates = async (peerId: string) => {
    if (peerId in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[peerId]) {
        await this.peers[peerId].addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }

  private async handleSignalingData(message: any) {
    try {
      // Trying to parse Webrtc messages
      let data = JSON.parse(atob(message.msg))
      let peerId = message.from
      message.msg = data
      console.log(`Received msg: ${JSON.stringify(message)}`)
      switch (data.sdp.type) {
        case 'offer':
          console.log(`callee received offer from peers ${peerId}`)
          // notice: this.userId: id of receiver offer
          await this.peers[peerId].setRemoteDescription(new RTCSessionDescription(data.sdp));
          // we create an answer for send it back to other peers
          const answer = await this.peers[peerId].createAnswer();
          // set local SDP for callee
          await this.peers[peerId].setLocalDescription(answer);
          // sending sdp local back to caller
          this.websocketSvc.sendMessage({
            from: this.userId,
            roomId: this.meetingId,
            msg: btoa(JSON.stringify({sdp: answer}))
          })
          // adding to pending list
          await this.addPendingCandidates(peerId).then()
          break
        case 'answer':
          console.log('answer')
          await this.peers[peerId].setRemoteDescription(new RTCSessionDescription(data.sdp));
          break
        default:
          if (data.sdp.candidate) {
            console.log('candidate')
            if (peerId in this.peers) {
              await this.peers[peerId].addIceCandidate(new RTCIceCandidate(data.sdp))
            } else {
              if (!(peerId in this.pendingCandidates)) {
                this.pendingCandidates[peerId] = []
              }
              this.pendingCandidates[peerId].push(data.sdp)
            }
          } else {
            console.log(`Received unknown msg: ${JSON.stringify(data)}`)
          }
      }
    } catch (e) {
      console.log(e)
      // normal message chatting, just a websocket chat example
      this.wsMessages.push(message)
    }
  }
}
