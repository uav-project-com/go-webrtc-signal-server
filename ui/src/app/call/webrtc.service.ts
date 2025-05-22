import { Injectable } from '@angular/core';
import {MEDIA_TYPE, WebsocketService} from './websocket.service';
import {RoomInfo} from "./RoomInfo";

const ENABLE_LOCAL_VIDEO = true

@Injectable({
  providedIn: 'root'
})
export class WebRTCService {
  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  private localStream: MediaStream
  private roomMaster = false
  private readonly roomId: string
  // list peerConnection: create new element for each peerId (not my userId)
  private peers = {}
  private pendingCandidates = {}
  readonly userId: string;
  public onCall: boolean;

  constructor(private websocketSvc: WebsocketService, room: RoomInfo) {
    this.roomId = room.roomId
    this.userId = room.userId
  }

  public async init(id: any) {
    console.warn(`id: ${id}`)
    const pc = new RTCPeerConnection(this.config)
    pc.onicecandidate = (e: any) => {
      console.log('ICE Candidate Event Triggered:', e.candidate)
      if (e.candidate) {
        // sending offer to other peers (broadcast)
        this.websocketSvc.sendMessage({
          roomId: this.roomId,
          msg: btoa(JSON.stringify({type: 'candidate', sdp: e.candidate}))
        }, MEDIA_TYPE)
      }
    }

    // add track
    pc.ontrack = (event: any) => {
      console.warn('ontrack event triggered', event)
      console.log('Streams received:', event.streams)

      if (event.streams.length === 0) {
        console.error('No streams available in ontrack event')
        return
      }
      let video = document.getElementById(id) as HTMLVideoElement
      if (!video) {
        video = document.createElement('video')
        video.autoplay = true
        video.srcObject = event.streams[0]
        video.id = id
        video.playsInline = true
        document.querySelector('#remoteStreams').appendChild(video)
      } else {
        console.log('Updating existing remote video element')
        video.srcObject = event.streams[0]
      }
    }
    pc.oniceconnectionstatechange = () => {
      console.warn('ICE Connection State:', pc.iceConnectionState)
    }

    pc.onsignalingstatechange = () => {
      console.warn('Signaling State:', pc.signalingState)
    }

    // add track
    this.localStream.getTracks().forEach(track => {
      pc.addTrack(track, this.localStream)
    })

    // sending offer to other joiner room
    if (this.roomMaster) {
      // The caller creates an offer and sets it as its local description before sending it to the remote peer via WebSocket.
      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      this.websocketSvc.sendMessage({
        roomId: this.roomId,
        msg: btoa(JSON.stringify({type: offer.type, sdp: offer}))
      }, MEDIA_TYPE)
    }
    return pc
  }

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   */
  public async startVideoCall(senderId: any) {
    this.roomMaster = true
    // only call when local init RTCPeerConnection, disable local video => ko chạy đoạn code if này
    await navigator.mediaDevices.getUserMedia({video: true, audio: false}).then(stream => {
      console.log('Stream found')
      this.addLocalVideoElement(stream)
    })
    this.peers[senderId] = await this.init(senderId)
  }

  /**
   * Processing message for video peer-connection
   * @param data payload of websocket message
   * @param senderId id of sender
   * @private
   */
  public async handleSignalingMediaMsg(data: any, senderId: string) {
    switch (data.type) {
      case 'offer':
        console.log(`callee received offer from peers ${JSON.stringify(data.sdp)}`)
        // get User media for receiver
        await navigator.mediaDevices.getUserMedia({video: true, audio: false}).then(stream => {
          console.log('Stream found')
          this.addLocalVideoElement(stream)
        })
        // create new peer-connection object map with peerId for receive remote video
        this.peers[senderId] = await this.init(senderId)
        await this.peers[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp))
        // we create an answer for send it back to other peers
        const answer = await this.peers[senderId].createAnswer()
        // set local SDP for callee
        await this.peers[senderId].setLocalDescription(answer)
        // sending sdp local back to caller
        this.websocketSvc.sendMessage({
          roomId: this.roomId,
          msg: btoa(JSON.stringify({type: answer.type, sdp: answer}))
        }, MEDIA_TYPE)
        break
      case 'answer':
        console.log(`answer: ${JSON.stringify(data.sdp)}`)
        if (this.peers[senderId].signalingState !== 'closed') {
          await this.peers[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp))
        }
        break
      case 'candidate':
        console.log(`candidate: ${JSON.stringify(data.sdp)}`)
        await this.peers[senderId].addIceCandidate(new RTCIceCandidate(data.sdp))
        break
      case 'removeTrack':
        await this.removeTrack(senderId)
        break
      default:
    }
  }

  public hangup() {
    // this.peers[this.peerId].close()
    this.onCall = false
  }

  public async toggleMediaCall(enable: boolean) {
    if (!enable) {
      console.log('Disabling video call');
      // 🔥 Notify other peers that media is stopped
      this.websocketSvc.sendMessage({
        roomId: this.roomId,
        msg: btoa(JSON.stringify({type: 'removeTrack', sid: this.userId}))
      }, MEDIA_TYPE);
    } else {
      const localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: false})
      this.addLocalVideoElement(localStream)
      for (const track of localStream.getTracks()) {
        for (const sid in this.peers) {
          if (Object.prototype.hasOwnProperty.call(this.peers, sid)) {
            this.peers[sid].addTrack(track, localStream)
            // Renegotiate the connection to update media
            const offer = await this.peers[sid].createOffer()
            await this.peers[sid].setLocalDescription(offer)
            this.websocketSvc.sendMessage({
              roomId: this.roomId,
              msg: btoa(JSON.stringify({type: offer.type, sdp: offer}))
            }, MEDIA_TYPE)
          }
        }
      }
      console.log('Local media resuming')
    }
  }

  private addLocalVideoElement = (stream: any) => {
    this.onCall = true
    this.localStream = stream
    if (ENABLE_LOCAL_VIDEO) { // giả sử máy Bob là máy watching only (điều khiển UAV)
      const localVideo = document.getElementById(this.userId) as HTMLVideoElement
      if (!localVideo) {
        console.log('create local video')
        const newRemoteStreamElem = document.createElement('video')
        newRemoteStreamElem.autoplay = true
        newRemoteStreamElem.srcObject = stream
        newRemoteStreamElem.id = this.userId
        document.querySelector('#localStream').appendChild(newRemoteStreamElem)
      } else {
        localVideo.srcObject = stream
      }
    }
  }

  public async removeTrack(sid: string) {
    if (this.peers[sid] != null) {
      const senders = this.peers[sid].getSenders(); // Get all RTP senders

      for (const sender of senders) {
        if (sender.track) {
          sender.track.stop(); // Stop the media track
          await this.peers[sid].removeTrack(sender); // Remove the track from the peer connection
        }
      }

      // Remove video element
      const videoElement = document.getElementById(sid);
      if (videoElement) videoElement.remove();
    }
  }
}
