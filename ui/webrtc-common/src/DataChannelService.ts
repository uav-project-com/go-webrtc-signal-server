import {SignalMsg, SignalType} from './dto/SignalMsg';
import {Message} from '../../src/app/call/Message';
import {REQUEST_VIDEO_CALL} from '../../src/app/call/data.channel-multiple.service';
import {DATA_TYPE} from '../../src/app/call/websocket.service';

export class DataChannelService extends EventTarget {

// -----------------Private fields------------------------------
  // turn servers config
  private readonly config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  }
  // need for create new room or join to room
  private readonly userId: string
  // need for create new room or join to room
  private readonly roomId: string
  // interface for sending/exchange signal webrtc message like offer, answer, candidate... like websocket
  private readonly sendSignaling: any

  // lưu các obj RTCPeerConnection khi cần broadcast message cho nhiều user trong room qua data-channel theo mesh
  private peers: Map<string, RTCPeerConnection> = new Map<string, RTCPeerConnection>()
  // lưu tạm thời các object offer khi mà state của peer chưa ready for offer nhưng lại nhận được offer từ peer khác
  private pendingCandidates: { [sid: string]: any } = {};
  // lưu kênh chat của các peer
  private dataChannels: { [sid: string]: any } = {}

// -----------------PrivateConstructor--------------------------


  constructor(userId: string, roomName: string, sendSignalMessageCallback: any)
  constructor(userId: string, roomName: string, sendSignalMessageCallback: any, signalServers?: RTCConfiguration) {
    super();
    if (signalServers) {
      this.config = signalServers
    }
    this.userId = userId
    this.roomId = roomName
    this.sendSignaling = sendSignalMessageCallback
  }

// -----------------Private functions---------------------------
  /**
   * For dispatch on received message from data-channel
   * @param message incoming message
   * @private
   */
  private onMessage(message: string) {
    // Dispatch custom event
    const event = new CustomEvent('message', {
      detail: {message}
    });
    this.dispatchEvent(event);
  }

  private async handlerOfferDataChannel(sid: string, data: any) {
    console.log(`handler offer from ${sid} with data ${data}`)
    const peer = this.peers.get(sid)
    if (peer) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.sdp))
      console.log(`2 peer is: ${JSON.stringify(peer)}`)
      const answer = await peer.createAnswer()
      await peer.setLocalDescription(answer)
      this.peers.set(sid, peer)
      const answerMsg: Message = {
        msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
        roomId: this.roomId,
        from: this.userId,
        to: sid
      }
      this.sendSignaling(answerMsg)
    }
  }

  /**
   * Xử lý tín hiệu message kết nối data-channel qua websocket
   * @param message msg websocket
   */
  public async handleSignalingData(message: SignalMsg) {
    const data = message.msg
    const sid = message.from
    if (sid === this.userId) return;
    if (!this.peers.get(sid) && data.type === SignalType.offer) {
      await this.createDataChannelConnection(sid, false)
    }
    switch (data.type) {
      case SignalType.offer:
        await this.handlerOfferDataChannel(sid, data)
        await this.addPendingCandidates(sid)
        break
      case SignalType.answer:
        console.log('received msg: answer')
        if (this.peers.get(sid)?.signalingState === 'have-local-offer') {
          await this.peers.get(sid)?.setRemoteDescription(new RTCSessionDescription(data.sdp))
        }
        break
      case SignalType.candidate:
        if (this.peers.has(sid) && this.peers.get(sid)?.remoteDescription) {
          await this.peers.get(sid)?.addIceCandidate(new RTCIceCandidate(data.sdp))
        } else {
          if (!(sid in this.pendingCandidates)) {
            this.pendingCandidates[sid] = []
          }
          this.pendingCandidates[sid] = data.sdp
        }
        break
      default:
    }
  }

  /**
   * Get candidates from list pending when other peers sent it too early
   * @param sid sender candidate
   */
  private addPendingCandidates = async (sid: string) => {
    if (sid in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[sid]) {
        await this.peers.get(sid)?.addIceCandidate(new RTCIceCandidate(candidate))
      }
    }
  }

// -----------------Public functions----------------------------

  /**
   * Init data-channel peer connection
   * @param sid peer id
   * @param isCaller true when this peer will be sent offer signal (who is joining to existing room)
   */
  public async createDataChannelConnection(sid: string, isCaller: boolean) {
    console.log(`setup data channel for ${sid}`)
    // Unlike video, DataChannel requires a bidirectional connection:
    const peer = new RTCPeerConnection(this.config)
    this.peers.set(sid, peer)
    // candidate event
    peer.onicecandidate = (event: { candidate: any }) => {
      if (event.candidate) {
        const answerMsg: SignalMsg = {
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        }
        this.sendSignaling(answerMsg)
      }
    }

    // // Handle incoming DataChannel from remote peer `sid`
    peer.ondatachannel = (event: { channel: RTCDataChannel }) => {
      const channel = event.channel
      channel.onmessage = (messageEvent: any) => {
        console.log('Received message from sender:', messageEvent.data)
        this.onMessage(messageEvent);
      }
      channel.onopen = () => {
        console.log('DataChannel Open')
      }
      this.dataChannels[sid] = channel // Store the data channel reference
    }

    console.log(`before create offer, userId: ${this.userId}, sid: ${sid}`)
    if (isCaller) { // nếu 2 bên chưa gửi offer, chiếm lấy việc gửi offer ngay tức thì
      // Assume We are the first one join to room, so let create that room: Create sender's data channel
      const channel = peer.createDataChannel('chat')
      channel.onmessage = (event: any) => {
        this.onMessage(event);
      }
      this.dataChannels.set(sid, channel)

      // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
      // sending offer info to other peerIde
      peer.createOffer().then(async (offer: any) => {
        await peer.setLocalDescription(offer)
        console.log(new Date() + ` data2WaySender.createOffer ${sid}`)
        const data: SignalMsg = {
          msg: btoa(JSON.stringify({type: offer.type, sdp: offer})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        }
        this.sendSignaling(data)
      })
    }
    peer.addEventListener('connectionstatechange', (_event: any) => {
      console.log('connectionstatechange-state:' + peer.connectionState)
      if (peer.connectionState === 'connected') {
        console.log('datachannel connected!')
      }
    })
  }

  /**
   * Chatting with webrtc Data-channel
   */
  public async sendMsg(message: string) {
    // send broadcast to all other peers
    Object.entries(this.dataChannels).forEach(([_sid, channel]) => {
      if (channel && channel.readyState === 'open') {
        channel.send(message)
      }
    });
  }

// -----------------Events - callback---------------------------
  // event when received message from peer in data-channel
  public addOnMessageEventListener(listener: (msg: string) => void) {
    this.addEventListener('message', (e: Event) => {
      const customEvent = e as CustomEvent;
      listener(customEvent.detail.msg);
    });
  }
}
