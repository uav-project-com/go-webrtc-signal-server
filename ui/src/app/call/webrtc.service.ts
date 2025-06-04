import { Injectable } from '@angular/core';
import {MEDIA_TYPE, WebsocketService} from '../common/websocket.service';
import {RoomInfo} from '../common/RoomInfo';

@Injectable({
  providedIn: 'root'
})
export class WebRTCService {
  private config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  private localStream: MediaStream
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

  public async initPeerConnection(id: string, addRemoteVideoCallback: any) {
    console.warn(`id: ${id}`)
    const pc = new RTCPeerConnection(this.config)
    pc.onicecandidate = (e: any) => {
      console.log('ICE Candidate Event Triggered:', e.candidate)
      if (e.candidate) {
        // sending offer to other peers (broadcast)
        this.websocketSvc.sendMessage({
          from: this.userId,
          to: id,
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
      addRemoteVideoCallback(event.streams[0], id)
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
    return pc
  }

  /**
   * Creating data-channel connection p2p after websocket connect for controlling UAV
   * @param senderId sender websocket
   * @param isCaller caller
   * @param addLocalVideoCallback callback to UI local video
   * @param addRemoteVideoCallback callback to UI remote video
   */
  public async startVideoCall(senderId: any, isCaller: boolean, addRemoteVideoCallback: any, addLocalVideoCallback: any) {
    console.warn(`Start video call with master: ${isCaller}`)
    // only call when local init RTCPeerConnection, disable local video => ko chạy đoạn code if này
    await navigator.mediaDevices.getUserMedia({video: true, audio: false}).then(stream => {
      console.log('Stream found')
      this.addLocalStream(stream, addLocalVideoCallback)
    })
    const peer = await this.initPeerConnection(senderId, addRemoteVideoCallback)
    if (isCaller) { // chiếm quyền call offer
      // sending offer to other joiner room
      // The caller creates an offer and sets it as its local description before sending it to the remote peer via WebSocket.
      const offer = await peer.createOffer()
      await peer.setLocalDescription(offer)
      this.websocketSvc.sendMessage({
        from: this.userId,
        to: senderId,
        roomId: this.roomId,
        msg: btoa(JSON.stringify({type: offer.type, sdp: offer}))
      }, MEDIA_TYPE)
    }
    this.peers[senderId] = peer
  }

  /**
   * Processing message for video peer-connection
   * @param message payload of websocket message
   * @param addRemoteVideoCallback for set remote video stream
   * @param addLocalVideoCallback for set local video stream
   * @private
   */
  public async handleSignalingMediaMsg(message: any, addRemoteVideoCallback: any, addLocalVideoCallback: any) {
    const data = message.msg
    const senderId = message.from
    if (this.peers[senderId] == null && data.type === 'offer') {
      console.warn(`data.type: ${data.type} sid: ${senderId}`)
      await this.startVideoCall(senderId, false, addRemoteVideoCallback, addLocalVideoCallback)
    }
    switch (data.type) {
      case 'offer':
        console.warn(`peer: ${this.peers[senderId] == null} sid: ${senderId}`)
        // create new peer-connection object map with peerId for receive remote video
        await this.peers[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp))
        // we create an answer for send it back to other peers
        const answer = await this.peers[senderId].createAnswer()
        // set local SDP for callee
        await this.peers[senderId].setLocalDescription(answer)
        // sending sdp local back to caller
        this.websocketSvc.sendMessage({
          from: this.userId,
          to: senderId,
          roomId: this.roomId,
          msg: btoa(JSON.stringify({type: answer.type, sdp: answer}))
        }, MEDIA_TYPE)
        // add pending candidate cached which received from websocket too early
        await this.addPendingCandidates(senderId)
        break
      case 'answer':
        console.log(`answer: ${JSON.stringify(data.sdp)}`)
        if (this.peers[senderId] && this.peers[senderId].signalingState === 'have-local-offer') {
          await this.peers[senderId].setRemoteDescription(new RTCSessionDescription(data.sdp))
        }
        break
      case 'candidate':
        console.log(`candidate: ${JSON.stringify(data.sdp)}`)
        if (senderId in this.peers && this.peers[senderId].remoteDescription) {
          await this.peers[senderId].addIceCandidate(new RTCIceCandidate(data.sdp))
        } else {
          if (!(senderId in this.pendingCandidates)) {
            this.pendingCandidates[senderId] = []
          }
          this.pendingCandidates[senderId].push(data.sdp)
        }
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

  public async toggleMediaCall(enable: boolean, addLocalVideoCallback: any) {
    if (!enable) {
      console.log('Disabling video call');
      // 🔥 Notify other peers that media is stopped
      this.websocketSvc.sendMessage({
        roomId: this.roomId,
        msg: btoa(JSON.stringify({type: 'removeTrack', sid: this.userId}))
      }, MEDIA_TYPE);
    } else {
      const localStream = await navigator.mediaDevices.getUserMedia({video: true, audio: false})
      this.addLocalStream(localStream, addLocalVideoCallback)
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

  private addLocalStream = (stream: any, addLocalVideoCallback: any) => {
    this.onCall = true
    this.localStream = stream
    addLocalVideoCallback(stream, this.userId)
  }

  /**
   * Get candidates from list pending when other peers sent it too early
   * @param sid sender candidate
   */
  private addPendingCandidates = async (sid: string) => {
    if (!this.peers[sid] || !this.peers[sid].remoteDescription) {
      return
    }
    if (sid in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[sid]) {
        await this.peers[sid].addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }
}
