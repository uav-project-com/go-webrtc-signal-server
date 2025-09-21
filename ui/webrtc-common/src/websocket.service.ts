import { WebSocketSubject } from 'rxjs/webSocket';
import {catchError, Observable, of, retry, RetryConfig} from 'rxjs';
import {SignalMsg} from './dto/SignalMsg';
import {Base64Util} from './common/Base64Util';

export class WebsocketService {
  // Observable - Stream variable => varName$
  private socket$: WebSocketSubject<any> | null = null;
  private readonly url: string = ''; // Replace with your WebSocket URL

  constructor(url: string = 'ws://localhost:8080/ws') {
    this.url = url;
  }

  connect(roomId: string, userId: string): void {
    const retryConfig: RetryConfig = {
      delay: 1000,
    };
    if (!this.socket$ || this.socket$.closed) {
      const joinUrl = `${this.url}/join/${roomId}/c/${userId}`
      console.log(`connecting to: ${joinUrl}`)
      this.socket$ = new WebSocketSubject(joinUrl);
      this.socket$
      .pipe(
        retry(retryConfig) // support auto reconnect
      )
    }
  }

  /**
   * Using for send signaling
   * @param message msg signaling
   */
  send(message: SignalMsg): void {
    console.log(`Sending \n ${JSON.stringify(message)}`)
    try {
      console.log(`Sending-decodeB64 \n ${Base64Util.base64ToObject(message.msg, true)}`)
    } catch (e) {
      console.log('ignore error', e)
    }
    try {
      this.socket$?.next(message);
    } catch (e) {
      console.error('Websocket send error', e)
    }
  }

  /**
   *  Subscribe để nhận tin nhắn từ WebSocket
   * @returns Observable
   */
  getMessages(): Observable<any> {
    return this.socket$?.asObservable().pipe(
      catchError((error: Error) => {
        console.error('WebSocket error:', error);
        return of(null);
      })
    ) ?? of(null);
  }

  close(): void {
    this.socket$?.complete();
  }
}
