import { Injectable } from '@angular/core';
import { WebSocketSubject } from 'rxjs/webSocket';
import { Observable, RetryConfig, catchError, of, retry } from 'rxjs';
import { Message } from './Message';

export const MEDIA_TYPE = "md"
export const DATA_TYPE = "dt"

@Injectable({
  providedIn: 'root'
})
export class WebsocketService {
  // Observable - Stream variable => varName$
  private socket$: WebSocketSubject<any> | null = null;
  private url = 'ws://192.168.1.103:8080/ws'; // Replace with your WebSocket URL

  constructor() { }

  connect(roomId: string, userId: string): void {
    const retryConfig: RetryConfig = {
      delay: 1000,
    };
    if (!this.socket$ || this.socket$.closed) {
      let joinUrl = `${this.url}/join/${roomId}/c/${userId}`
      console.log(`connecting to: ${joinUrl}`)
      this.socket$ = new WebSocketSubject(joinUrl);
      this.socket$
      .pipe(
        retry(retryConfig) //support auto reconnect
      )
    }
  }

  sendMessage(message: Message, type?: string): void {
    if (type && type === DATA_TYPE) {
      // dt => data-channel
      message.channel = DATA_TYPE
      this.socket$?.next(message);
    } else if (type && type === MEDIA_TYPE) {
      // md => media
      message.channel = MEDIA_TYPE
    }
    this.socket$?.next(message);
    let log = null
    try {
      message.msg = atob(message.msg)
      log = JSON.stringify(message)
      console.log(`ws sending: ${log}`)
    } catch (e) {
      console.error(e)
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
