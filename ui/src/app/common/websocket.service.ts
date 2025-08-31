import { Injectable } from '@angular/core';
import { WebSocketSubject } from 'rxjs/webSocket';
import { Observable, RetryConfig, catchError, of, retry } from 'rxjs';
import { Message } from './Message';
import { environment } from '../../environments/environment';
import {Base64Util} from 'webrtc-common/dist/common/Base64Util';

export const MEDIA_TYPE = 'md'
export const DATA_TYPE = 'dt'

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

  send(message: any): void {
    console.log(`Sending \n ${JSON.stringify(message)}`)
    try {
      console.log(`Sending-decodeB64 \n ${Base64Util.base64ToObject(message.msg)}`)
    } catch (_e) {}
    try {
      this.socket$?.next(message);
    } catch (e) {
      console.error('Websocket send error', e)
    }
  }

  sendMessage(message: Message, type?: string): void {
    if (!message.from) {
      message.from = this.defaultSrcId
    }
    if (type && type === DATA_TYPE) {
      // dt => data-channel
      message.channel = DATA_TYPE
    } else if (type && type === MEDIA_TYPE) {
      // md => media
      message.channel = MEDIA_TYPE
    }
    this.socket$?.next(message);
    const msg = Base64Util.base64ToObject(message.msg)
    console.log(`ws sending: ${msg}`)
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
