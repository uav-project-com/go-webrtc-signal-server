import {VideoChannelService} from '../video-channel.service';

export class VideoElementUtil {
  static readonly micBtnClass = 'toggle-mic-btn'
  static readonly hangUpClass = 'hangup'
  static readonly remoteVideoContainerClass = 'participant-grid'

  // holds a reference to the VideoChannelService (or compatible object)
  private static videoChannelSvc: any = null

  /**
   * Adds a video element to the DOM for a given stream and user ID.
   * @param stream The MediaStream to attach to the video element.
   * @param userId The ID of the user associated with the stream.
   * @param containerSelector The CSS selector for the container to append the video element.
   */
  static addVideoElement(stream: MediaStream, userId: string, containerSelector: string): void {
    let videoEl = document.getElementById('video-' + userId) as HTMLVideoElement
    if (!videoEl) {
      const container = document.querySelector(containerSelector)
      if (container) {
        // Create a div tile
        const tileDiv = document.createElement('div')
        tileDiv.className = 'tile'

        // Create video element
        videoEl = document.createElement('video')
        videoEl.id = 'video-' + userId
        videoEl.autoplay = true
        videoEl.playsInline = true
        videoEl.className = 'dynamic-video'

        // Append video to tile, tile to container
        tileDiv.appendChild(videoEl)
        container.appendChild(tileDiv)
      }
    }
    if (videoEl) {
      videoEl.srcObject = stream
    }
  }

  private static addHangUpEvent() {
    const elements = document.getElementsByClassName(VideoElementUtil.hangUpClass)
    if (elements.length === 0) {
      // no button found — nothing to wire
      console.warn(`VideoElementUtil: no elements found for .${VideoElementUtil.micBtnClass}`)
      return
    }

    Array.from(elements).forEach(el => {
      // avoid adding duplicate listeners by removing previous if present
      (el as HTMLElement).removeEventListener('click', VideoElementUtil._onHangUp as EventListener);
      (el as HTMLElement).addEventListener('click', VideoElementUtil._onHangUp as EventListener);
    })
  }

  /**
   * Attach click listeners to mic toggle elements and call the provided service's toggleLocalMic.
   * If there are multiple elements with the mic class, install handler on all.
   */
  private static addToggleMicEvent() {
    const elements = document.getElementsByClassName(VideoElementUtil.micBtnClass)
    if (elements.length === 0) {
      // no button found — nothing to wire
      console.warn(`VideoElementUtil: no elements found for .${VideoElementUtil.micBtnClass}`)
      return
    }

    Array.from(elements).forEach(el => {
      // avoid adding duplicate listeners by removing previous if present
      (el as HTMLElement).removeEventListener('click', VideoElementUtil._onMicClick as EventListener);
      (el as HTMLElement).addEventListener('click', VideoElementUtil._onMicClick as EventListener);
    })
  }

  private static readonly _onHangUp = () => {
  if (VideoElementUtil.videoChannelSvc && typeof VideoElementUtil.videoChannelSvc.hangUp === 'function') {
    VideoElementUtil.videoChannelSvc.hangUp()
  } else {
    console.warn('VideoElementUtil: videoSvc or hangUp() not available')
  }
}

  private static readonly _onMicClick = () => {
    console.log('VideoElementUtil: toggle mic clicked')
    if (VideoElementUtil.videoChannelSvc && typeof VideoElementUtil.videoChannelSvc.toggleLocalMic === 'function') {
      try {
        VideoElementUtil.videoChannelSvc.toggleLocalMic()
      } catch (err) {
        console.warn('VideoElementUtil: error invoking toggleLocalMic', err)
      }
    } else {
      console.warn('VideoElementUtil: videoSvc or toggleLocalMic() not available')
    }
  }

  /**
   * Initialize control wiring. Pass the video service instance so UI buttons can call service methods.
   * Call this after `videoChannelSvc` is created.
   */
  public static async initControls(videoSvc: VideoChannelService, localVideo: HTMLVideoElement,
                                   listRemoteStream: { [userId: string]: MediaStream },
                                   userIds: string[]
  ) {
    VideoElementUtil.videoChannelSvc = videoSvc
    // insert video element khi có remote stream connected
    VideoElementUtil.videoChannelSvc.addOnRemoteStreamListener((stream: MediaStream, from: string) => {
      console.log(`Received new stream: ${from}`)
      listRemoteStream[from] = stream;
      const containerRemoteVideoElement =
        document.getElementsByClassName(this.remoteVideoContainerClass)
      if (containerRemoteVideoElement.length !== 1) {
        console.warn(`Container class remote video not found or duplicated: ${this.remoteVideoContainerClass}`)
      }
      VideoElementUtil.addVideoElement(stream, from, '.' + this.remoteVideoContainerClass);
    });
    await VideoElementUtil.videoChannelSvc.addOnLocalStream((stream: MediaProvider) => {
      localVideo.srcObject = stream; // add local media to html element
    })
    VideoElementUtil.addToggleMicEvent()
    VideoElementUtil.addHangUpEvent()
    this.ngAfterViewChecked(userIds, listRemoteStream)
  }

  /**
   * ngAfterViewChecked trigger render again all remote videos
   * @param userIds list userIds updated
   * @param listRemoteStream list remote stream updated
   */
  private static ngAfterViewChecked(userIds: string[], listRemoteStream: { [userId: string]: MediaStream }) {
    const observer = new MutationObserver(() => {
      console.log('DOM changed');
      // Gán lại srcObject cho tất cả video remote
      userIds.forEach(user => {
        const videoEl = document.getElementById('video-' + user) as HTMLVideoElement;
        if (videoEl && listRemoteStream[user] && videoEl.srcObject !== listRemoteStream[user]) {
          videoEl.srcObject = listRemoteStream[user];
        }
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }
}
