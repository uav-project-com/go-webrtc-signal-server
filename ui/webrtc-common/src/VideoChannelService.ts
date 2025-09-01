import {Channel, SignalMsg, SignalType} from './dto/SignalMsg';
import {Base64Util} from './common/Base64Util';

/**
 * VideoChannelService
 * Quản lý kết nối WebRTC video call nhiều người (full mesh).
 * Mapping peerConnection theo userId, quản lý stream, signaling, và các event điều khiển video/mic.
 */
export class VideoChannelService extends EventTarget {
  private readonly config: RTCConfiguration = {
    iceServers: [{urls: 'stun:stun.l.google.com:19302'}]
  };
  private readonly userId: string;
  private readonly roomId: string;
  private readonly sendSignaling: any;

  private peers: { [sid: string]: RTCPeerConnection } = {};
  private streams: { [sid: string]: MediaStream } = {};
  private pendingCandidates: { [sid: string]: any[] } = {};
  private localStream: MediaStream | null = null;

  constructor(userId: string, roomName: string, sendSignalMessageCallback: any)
  /**
   * Khởi tạo VideoChannelService
   * @param userId - ID của user hiện tại
   * @param roomName - Tên phòng
   * @param sendSignalMessageCallback - Hàm gửi signaling (qua websocket)
   * @param signalServers - Cấu hình ICE server (tùy chọn)
   */
  constructor(userId: string, roomName: string, sendSignalMessageCallback: any, signalServers?: RTCConfiguration) {
    super();
    if (signalServers) {
      this.config = signalServers;
    }
    this.userId = userId;
    this.roomId = roomName;
    this.sendSignaling = sendSignalMessageCallback;
  }

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
   * Tạo peer connection cho video call với một user khác
   * @param sid - userId của peer
   * @param isCaller - true nếu là người khởi tạo offer
   */
  public async createVideoPeerConnection(sid: string, isCaller: boolean) {
    const peer = new RTCPeerConnection(this.config);
    this.peers[sid] = peer;

    // Add local stream tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        peer.addTrack(track, this.localStream!);
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
        this.sendSignaling(msg);
      }
    };

    // Nhận stream từ peer
    peer.ontrack = (event: RTCTrackEvent) => {
      if (!this.streams[sid]) {
        this.streams[sid] = new MediaStream();
      }
      this.streams[sid].addTrack(event.track);
      this.dispatchEvent(new CustomEvent('remoteStream', {detail: {stream: this.streams[sid], from: sid}}));
    };

    // Lắng nghe trạng thái kết nối
    peer.onconnectionstatechange = () => {
      this.dispatchEvent(new CustomEvent('connectionState', {detail: {state: peer.connectionState, from: sid}}));
    };

    // Nếu là caller, tạo offer và gửi cho peer
    if (isCaller) {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const msg: SignalMsg = {
        channel: Channel.Webrtc,
        msg: btoa(JSON.stringify({type: offer.type, sdp: offer})),
        roomId: this.roomId,
        from: this.userId,
        to: sid
      };
      this.sendSignaling(msg);
    }
  }

  /**
   * Xử lý signaling message nhận được từ server (offer/answer/candidate)
   * @param message - SignalMsg từ peer khác
   */
  public async handleSignalingData(message: SignalMsg) {
    const data = Base64Util.isBase64(message.msg)
      ? Base64Util.base64ToObject(message.msg)
      : message.msg;
    const sid = message.from;
    if (sid === this.userId) return;

    if (!this.peers[sid] && data.type === SignalType.offer) {
      await this.createVideoPeerConnection(sid, false);
    }

    switch (data.type) {
      case SignalType.offer:
        await this.peers[sid]?.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await this.peers[sid]?.createAnswer();
        await this.peers[sid]?.setLocalDescription(answer);
        const answerMsg: SignalMsg = {
          channel: Channel.Webrtc,
          msg: btoa(JSON.stringify({type: answer.type, sdp: answer})),
          roomId: this.roomId,
          from: this.userId,
          to: sid
        };
        this.sendSignaling(answerMsg);
        await this.getAndClearPendingCandidates(sid);
        break;
      case SignalType.answer:
        await this.peers[sid]?.setRemoteDescription(new RTCSessionDescription(data.sdp));
        break;
      case SignalType.candidate:
        if (this.peers.hasOwnProperty(sid) && this.peers[sid]?.remoteDescription) {
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
      this.pendingCandidates[sid] = [];
    }
    this.pendingCandidates[sid].push(candidate);
  }

  /**
   * Bật/tắt video cho local stream
   * @param enabled - true để bật, false để tắt
   */
  public toggleLocalVideo(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getVideoTracks().forEach(track => {
        track.enabled = enabled;
      });
      this.dispatchEvent(new CustomEvent('toggleVideo', {detail: {enabled}}));
    }
  }

  /**
   * Bật/tắt mic cho local stream
   * @param enabled - true để bật, false để tắt
   */
  public toggleLocalMic(enabled: boolean) {
    if (this.localStream) {
      this.localStream.getAudioTracks().forEach(track => {
        track.enabled = enabled;
      });
      this.dispatchEvent(new CustomEvent('toggleMic', {detail: {enabled}}));
    }
  }



  /**
   * Lấy remote stream của một peer theo userId
   * @param sid - userId của peer
   * @returns MediaStream hoặc undefined
   */
  public getRemoteStream(sid: string): MediaStream | undefined {
    return this.streams[sid];
  }

// -----------------Events - callback---------------------------

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
   * Đăng ký lắng nghe event khi bật/tắt video
   * @param listener - callback nhận trạng thái enabled
   */
  public addOnToggleVideoListener(listener: (enabled: boolean) => void) {
    this.addEventListener('toggleVideo', (e: Event) => {
      const customEvent = e as CustomEvent<{enabled: boolean}>;
      listener(customEvent.detail.enabled);
    });
  }

  /**
   * Đăng ký lắng nghe event khi bật/tắt mic
   * @param listener - callback nhận trạng thái enabled
   */
  public addOnToggleMicListener(listener: (enabled: boolean) => void) {
    this.addEventListener('toggleMic', (e: Event) => {
      const customEvent = e as CustomEvent<{enabled: boolean}>;
      listener(customEvent.detail.enabled);
    });
  }

}
