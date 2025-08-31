import {Channel, SignalMsg, SignalType} from './dto/SignalMsg';
import {Base64Util} from './common/Base64Util';

export class DataChannelService extends EventTarget {

// -----------------PrivateConstructor--------------------------


  constructor(userId: string, roomName: string, sendSignalMessageCallback: any)
  /**
   * Init data channel object
   * @param userId your uid
   * @param roomName name of socket room
   * @param sendSignalMessageCallback for sending signal message, usually use websocket
   * @param signalServers optional: when not use Google ICE server and deploy for your own
   */
  constructor(userId: string, roomName: string, sendSignalMessageCallback: any, signalServers?: RTCConfiguration) {
    super();
    if (signalServers) {
      this.config = signalServers
    }
    this.userId = userId
    this.roomId = roomName
    this.sendSignaling = sendSignalMessageCallback
  }

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
  private peers: { [sid: string]: any } = {};
  // lưu tạm thời các object offer khi mà state của peer chưa ready for offer nhưng lại nhận được offer từ peer khác
  private pendingCandidates: { [sid: string]: any } = {};
  // lưu kênh chat của các peer
  private dataChannels: { [sid: string]: any } = {}



// -----------------Private functions---------------------------
  /**
   * For dispatch on received message from data-channel
   * @param message incoming message
   * @param from sender
   * @private
   */
  private onMessage(message: string, from: string) {
    // Dispatch custom event
    const event = new CustomEvent('message', {
      detail: {message, from}
    });
    this.dispatchEvent(event);
  }

  private async handlerOfferDataChannel(sid: string, data: any) {
    console.log(`handler offer from ${sid} with data ${data}`)
    const peer = this.peers[sid]
    if (peer) {
      await peer.setRemoteDescription(new RTCSessionDescription(data.sdp)) // (#8)
      console.log(`remote peer is: ${JSON.stringify(peer)}`)
      const answer = await peer.createAnswer() // (#10)
      await peer.setLocalDescription(answer) // (#11)
      this.peers[sid] = peer
      const answerMsg: SignalMsg = {
        channel: Channel.DataRtc,
        msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
        roomId: this.roomId,
        from: this.userId,
        to: sid
      }
      this.sendSignaling(answerMsg) // (#12)
      // Nếu tồn tại candidate được gửi từ trước khi pc đuược tạo, tiến hành add Pending Candidate
      await this.getAndClearPendingCandidates(sid)
    }
  }

  /**
   * Xử lý tín hiệu message kết nối data-channel qua websocket
   * @param message msg websocket
   */
  public async handleSignalingData(message: SignalMsg) {
    const data = Base64Util.isBase64(message.msg) ?
      Base64Util.base64ToObject((message.msg)) :
      message.msg
    const sid = message.from
    console.log(`Received signal ws: ${sid} : \n${JSON.stringify(data)}`)
    if (sid === this.userId) return; // ignore loop back ws msg
    if (!this.peers[sid] && data.type === SignalType.offer) {
      console.log(`creating datachannel with sid ${sid} and master = false`)
      await this.createDataChannelConnection(sid, false) // (#6)
    }
    switch (data.type) {
      case SignalType.offer:
        await this.handlerOfferDataChannel(sid, data) // (#8)
        break
      case SignalType.answer: // (#13)
        console.log('received msg: answer')
        if (this.peers[sid]?.signalingState === 'have-local-offer') {
          await this.peers[sid]?.setRemoteDescription(new RTCSessionDescription(data.sdp)) // (#14)
        }
        break
      case SignalType.candidate:
        if (this.peers.hasOwnProperty(sid) && this.peers[sid]?.remoteDescription) {
          console.log(`set candidate to PC of ${sid}`)
          await this.peers[sid]?.addIceCandidate(new RTCIceCandidate(data.sdp))
        } else {
          this.addPendingCandidates(sid, data.sdp);
        }
        break
      default:
    }
  }

  /**
   * Get candidates from list pending when other peers sent it too early
   * @param sid sender candidate
   */
  private getAndClearPendingCandidates = async (sid: string) => {
    if (sid in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[sid]) {
        await this.peers[sid]?.addIceCandidate(new RTCIceCandidate(candidate))
      }
      this.pendingCandidates[sid] = []
    }
  }

  private addPendingCandidates(sid: string, candidate: any) {
    if (!(sid in this.pendingCandidates)) {
      this.pendingCandidates[sid] = [] // khởi tạo mảng lưu sdp theo sid
    }
    this.pendingCandidates[sid].push(candidate)
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
    const peer = new RTCPeerConnection(this.config) // (#3) (#7)
    this.peers[sid] = peer // mapping A-Bn-sid
    // candidate event
    peer.onicecandidate = (event: { candidate: any }) => {
      // ICE trao đổi → dcA_B1 <-> dcB1 open
      if (event.candidate) {
        const answerMsg: SignalMsg = {
          channel: Channel.DataRtc,
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        }
        this.sendSignaling(answerMsg)
      }
    }

    // (#9) Handle incoming DataChannel from remote peer `sid`
    peer.ondatachannel = (event: { channel: RTCDataChannel }) => {
      const channel = event.channel
      channel.onmessage = (messageEvent: any) => {
        console.log('Received message from sender:', messageEvent.data)
        this.onMessage(messageEvent.data, sid);
      }
      channel.onopen = () => {
        console.log('DataChannel Open')
      }
      console.log(`1. add data-channel ${sid} with channel ${channel}`)
      this.dataChannels[sid] = channel // Store the data channel reference
    }

    console.log(`before create offer, userId: ${this.userId}, sid: ${sid}`)
    if (isCaller) { // nếu 2 bên chưa gửi offer, chiếm lấy việc gửi offer ngay tức thì
      const channel = peer.createDataChannel('chat') // (#4)
      channel.onmessage = (event: any) => {
        this.onMessage(event.data, sid);
      }
      console.log(`2. add data-channel ${sid} with channel ${channel}`)
      this.dataChannels[sid] = channel

      // Creating webrtc datachannel connection FIRST for control UAV, Video stream and other will be init later
      // sending offer info to other peerIde
      peer.createOffer().then(async (offer: any) => {
        await peer.setLocalDescription(offer)
        console.log(new Date() + ` data2WaySender.createOffer ${sid}`)
        const data: SignalMsg = {
          channel: Channel.DataRtc,
          msg: btoa(JSON.stringify({type: offer.type, sdp: offer})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        }
        this.sendSignaling(data) // (#5)
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
  public addOnMessageEventListener(listener: (msg: string, from: string) => void) {
    this.addEventListener('message', (e: Event) => {
      const customEvent = e as CustomEvent<{ message: string; from: string }>;
      listener(customEvent.detail.message, customEvent.detail.from);
    });
  }
}
