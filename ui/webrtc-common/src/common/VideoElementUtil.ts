export class VideoElementUtil {
  /**
   * Adds a video element to the DOM for a given stream and user ID.
   * @param stream The MediaStream to attach to the video element.
   * @param userId The ID of the user associated with the stream.
   * @param containerSelector The CSS selector for the container to append the video element.
   */
  static addVideoElement(stream: MediaStream, userId: string, containerSelector: string): void {
    let videoEl = document.getElementById('video-' + userId) as HTMLVideoElement;
    if (!videoEl) {
      const container = document.querySelector(containerSelector);
      if (container) {
        // Create a div tile
        const tileDiv = document.createElement('div');
        tileDiv.className = 'tile';

        // Create video element
        videoEl = document.createElement('video');
        videoEl.id = 'video-' + userId;
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        videoEl.className = 'dynamic-video';

        // Append video to tile, tile to container
        tileDiv.appendChild(videoEl);
        container.appendChild(tileDiv);
      }
    }
    if (videoEl) {
      videoEl.srcObject = stream;
    }
  }
}