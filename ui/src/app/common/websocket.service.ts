import { Injectable } from '@angular/core';
import { WebSocketSubject } from 'rxjs/webSocket';
import { Observable, RetryConfig, catchError, of, retry } from 'rxjs';
import { environment } from '../../environments/environment';
import {Base64Util} from 'webrtc-common/dist/common/Base64Util';
import {SignalMsg} from 'webrtc-common/dist/dto/SignalMsg';

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  // Observable - Stream variable => varName$
  private socket$: WebSocketSubject<any> | null = null;
  private url = environment.socket; // Replace with your WebSocket URL
  private defaultSrcId: any

  constructor() { }

  connect(roomId: string, userId: string): void {
    this.defaultSrcId = userId
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
    } catch (_e) {}
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
      catchError((error) => {
        console.error('WebSocket error:', error);
        return of(null);
      })
    ) ?? of(null);
  }

  close(): void {
    this.socket$?.complete();
  }
}
