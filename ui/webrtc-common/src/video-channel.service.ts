import {Channel, SignalMsg, SignalType} from './dto/SignalMsg';
import {Base64Util} from './common/Base64Util';
import {WebsocketService} from './websocket.service';
import {Subscription} from 'rxjs';
import {CommonRtc} from './common/common-rtc';
import {REQUEST_JOIN_MEDIA_CHANNEL} from './common/const';

/**
 * VideoChannelService
 * Quản lý kết nối WebRTC video call nhiều người (full mesh).
 * Mapping peerConnection theo userId, quản lý stream, signaling, và các event điều khiển video/mic.
 */
export class VideoChannelService extends EventTarget {

  // ----------------- Khởi tạo & cấu hình -----------------
  private readonly config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  };
  private readonly userId: string;
  private readonly roomId: string;

  private peers: { [sid: string]: RTCPeerConnection } = {};
  private streams: { [sid: string]: MediaStream } = {};
  private pendingCandidates: { [sid: string]: any[] } = {};
  private localStream: MediaStream | null = null;

  private readonly websocketSvc: WebsocketService
  private readonly isMaster: any
  msgSubscription: Subscription | null = null
  // callback confirm to join from master's room
  private readonly confirmJoinCb: any;

  constructor(userId: string, roomName: string, isMaster: boolean, socketUrl: any)
  /**
   * Khởi tạo VideoChannelService
   * @param userId - ID của user hiện tại
   * @param roomName - Tên phòng
   * @param isMaster mark as master room
   * @param socketUrl - for sending signal message, usually use websocket
   * @param signalServers - Cấu hình ICE server (tùy chọn)
   */
  constructor(userId: string, roomName: string, isMaster: any, socketUrl: any, signalServers?: RTCConfiguration) {
    super();
    if (signalServers) {
      this.config = signalServers;
    }
    this.userId = userId;
    this.roomId = roomName;
    this.isMaster = isMaster
    // Auto init internal socket service for send signaling data
    this.websocketSvc = new WebsocketService(socketUrl)
    this.websocketSvc.connect(this.roomId, this.userId)
    // Khi nhận được signaling message từ websocket
    this.msgSubscription = this.websocketSvc.getMessages().subscribe(async (message) => {
      console.log(`received ws: ${JSON.stringify(message)}`)
      if (message && message.status === 200 && message.msg.startsWith('onConnected')) {
        // auto init data-channel for chat in real life logic
        this.initVideoCall()
      } else if (message.msg === REQUEST_JOIN_MEDIA_CHANNEL) {
        if (this.isMaster === 'true') {
          if (this.confirmJoinCb) {
            this.confirmJoinCb(`${message.from} want to join this room!`, () => {
              this.createVideoPeerConnection(message.from, this.isMaster).then()
            })
          } else {
            this.createVideoPeerConnection(message.from, this.isMaster).then()
          }
        } else {
          this.createVideoPeerConnection(message.from, this.isMaster).then()
        }
      } else if (CommonRtc.isSignalMsg(message) && message.channel === Channel.Webrtc) {
        await this.handleSignalingData(message)
      }
    })
  }

  // ----------------- WebRTC Core ------------------------

  private initVideoCall() {
    // Lắng nghe khi có remote stream mới từ peer
    this.toggleLocalVideo(true); // enabled local stream
    if (!this.isMaster) {
      // Bắt đầu video call
      // Request video call broadcast
      const msg: SignalMsg = {
        msg: REQUEST_JOIN_MEDIA_CHANNEL,
        from: this.userId,
        channel: Channel.Webrtc,
        roomId: this.roomId
      }
      this.websocketSvc.send(msg)
    }
  }

  /**
   * Tạo peer connection cho video call với một user khác
   * @param sid - userId của peer
   * @param isCaller - true nếu là người khởi tạo offer
   */
  private async createVideoPeerConnection(sid: string, isCaller: any) {
    const peer = new RTCPeerConnection(this.config);

    // Add local stream tracks
    if (this.localStream) {
      const ls = this.localStream
      this.localStream.getTracks().forEach(track => {
        peer.addTrack(track, ls);
      });
    }

    // Xử lý ICE candidate
    peer.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
      if (event.candidate) {
        const msg: SignalMsg = {
          channel: Channel.Webrtc,
          msg: btoa(JSON.stringify({type: 'candidate', sdp: event.candidate})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        };
        this.websocketSvc.send(msg);
      } else {
        console.log('ICE gathering complete');
      }
    };

    // Nhận stream từ peer
    peer.ontrack = (event: RTCTrackEvent) => {
      console.log(`remote peer Ontrack: ${sid}`)
      if (!this.streams[sid]) {
        this.streams[sid] = new MediaStream();
      }
      this.streams[sid].addTrack(event.track);
      this.dispatchEvent(new CustomEvent('remoteStream', {detail: {stream: this.streams[sid], from: sid}}));
    };

    // Lắng nghe trạng thái kết nối
    peer.onconnectionstatechange = () => {
      console.log(`connectionState: ${peer.connectionState}`)
      this.dispatchEvent(new CustomEvent('connectionState', {detail: {state: peer.connectionState, from: sid}}));
    };

    // Nếu là caller, tạo offer và gửi cho peer
    if (isCaller === 'true' || isCaller === null || isCaller === undefined) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const msg: SignalMsg = {
        channel: Channel.Webrtc,
        msg: btoa(JSON.stringify({type: offer.type, sdp: peer.localDescription})),
        roomId: this.roomId,
        from: this.userId,
        to: sid
      };
      this.websocketSvc.send(msg);
    }
    this.peers[sid] = peer;
  }

  /**
   * Xử lý signaling message nhận được từ server (offer/answer/candidate)
   * @param message - SignalMsg từ peer khác
   */
  private async handleSignalingData(message: SignalMsg) {
    const data = Base64Util.isBase64(message.msg)
      ? Base64Util.base64ToObject(message.msg)
      : message.msg;
    const sid = message.from;
    if (sid === this.userId) return;

    if (!this.peers[sid] && data.type === SignalType.offer) {
      await this.createVideoPeerConnection(sid, false);
    }

    switch (data.type) {
      case SignalType.offer: {
        console.log(`received offer ${data.sdp}`)
        await this.peers[sid]?.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await this.peers[sid]?.createAnswer();
        await this.peers[sid]?.setLocalDescription(answer);
        const answerMsg: SignalMsg = {
          channel: Channel.Webrtc,
          msg: btoa(JSON.stringify({type: answer.type, sdp: this.peers[sid]?.localDescription})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        };
        this.websocketSvc.send(answerMsg);
        await this.getAndClearPendingCandidates(sid);
        break;
      }
      case SignalType.answer:
        console.log(`sdp: ${data.sdp}`)
        await this.peers[sid]?.setRemoteDescription(new RTCSessionDescription(data.sdp));
        break;
      case SignalType.candidate:
        if (this.peers.hasOwnProperty(sid) && this.peers[sid]?.remoteDescription) {
          console.log(`adding candidate: ${data.sdp}`)
          await this.peers[sid]?.addIceCandidate(new RTCIceCandidate(data.sdp));
        } else {
          this.addPendingCandidates(sid, data.sdp);
        }
        break;
      default:
    }
  }

  /**
   * Lấy và add các ICE candidate pending cho peer khi peer đã sẵn sàng
   * @param sid - userId của peer
   */
  private async getAndClearPendingCandidates(sid: string) {
    if (sid in this.pendingCandidates) {
      for (const candidate of this.pendingCandidates[sid]) {
        await this.peers[sid]?.addIceCandidate(new RTCIceCandidate(candidate));
      }
      this.pendingCandidates[sid] = [];
    }
  }

  /**
   * Thêm ICE candidate vào danh sách pending nếu peer chưa sẵn sàng
   * @param sid - userId của peer
   * @param candidate - ICE candidate
   */
  private addPendingCandidates(sid: string, candidate: any) {
    if (!(sid in this.pendingCandidates)) {
      console.log(`init list candidate for ${sid}`)
      this.pendingCandidates[sid] = [];
    }
    console.log(`Adding pending candidate ${sid}`)
    this.pendingCandidates[sid].push(candidate);
  }
// =============================== P U B L I C  F U N C T I O N ========================================================
  /**
   * Thiết lập local stream cho user hiện tại và add vào tất cả peer connection đã có
   * @param stream - MediaStream local
   */
  public async setLocalStream(stream: MediaStream) {
    this.localStream = stream;
    Object.values(this.peers).forEach(peer => {
      stream.getTracks().forEach(track => {
        peer.addTrack(track, stream);
      });
    });
  }

  /**
   * Lấy remote stream của một peer theo userId
   * @param sid - userId của peer
   * @returns MediaStream hoặc undefined
   */
  public getRemoteStream(sid: string): MediaStream | undefined {
    return this.streams[sid];
  }

  public getRemoteStreams() {
    return this.streams;
  }

  public getLocalStream(): MediaStream | null {
    return this.localStream;
  }

  // ----------------- Điều khiển Media --------------------
  /**
   * Bật/tắt video cho local stream
   * @param enabled - true để bật, false để tắt
   */
  public toggleLocalVideo(enabled?: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = (!track.enabled || (enabled != null && enabled));
      });
    } else {
      console.error('Must init video first')
    }
  }

  /**
   * Bật/tắt mic cho local stream
   * @param enabled - true để bật, false để tắt
   */
  public toggleLocalMic(enabled?: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = (!track.enabled || (enabled != null && enabled));
      });
    }
  }

  public hangUp() {
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => track.stop());
    }
    // tslint:disable-next-line:forin
    for (const remoteStreamsKey in this.getRemoteStreams()) {
      this.getRemoteStream(remoteStreamsKey)?.getTracks().forEach(track => {
        track.stop()
      })
    }
  }

  // ----------------- Event UI Callback -------------------
  /**
   * Đăng ký lắng nghe event khi có remote stream mới từ peer
   * @param listener - callback nhận stream và userId
   */
  public addOnRemoteStreamListener(listener: (stream: MediaStream, from: string) => void) {
    this.addEventListener('remoteStream', (e: Event) => {
      const customEvent = e as CustomEvent<{stream: MediaStream; from: string}>;
      listener(customEvent.detail.stream, customEvent.detail.from);
    });
  }

  /**
   * getUserMedia and return to HTML control callback
   * @param callback
   */
  public async addOnLocalStream(callback: any) {
    const stream = await navigator.mediaDevices.getUserMedia({video: true, audio: false});
    callback(stream);
    this.localStream = stream;
  }

}
