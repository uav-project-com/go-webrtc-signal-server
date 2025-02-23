import { Injectable } from '@angular/core';
import { WebSocketSubject } from 'rxjs/webSocket';
import { Observable, RetryConfig, catchError, of, retry } from 'rxjs';
import { Message } from './Message';

@Injectable({
  providedIn: 'root'
})

export class WebsocketService {
  // Observable - Stream variable => varName$
  private socket$: WebSocketSubject<any> | null = null;
  private url = 'ws://localhost:8080/ws'; // Replace with your WebSocket URL

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

  sendMessage(message: Message): void {
    this.socket$?.next(message);
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