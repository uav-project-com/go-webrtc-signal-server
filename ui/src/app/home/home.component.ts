import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { environment } from '../../environments/environment';

// Danh sách 20 tên lowercase
const names: string[] = [
  'an', 'binh', 'cuc', 'dung', 'ezekiel', 'forentino', 'giang', 'hung', 'isis', 'khanh',
  'lan', 'minh', 'ngoc', 'oanh', 'phuc', 'quang', 'son', 'tam', 'uyen', 'vinh'
];

@Component({
  selector: 'app-call',
  templateUrl: './home.component.html',
  imports: [
    ReactiveFormsModule,
    FormsModule
  ],
  styleUrls: ['./home.component.css']
})
export class HomeComponent {

  constructor(private router: Router) {
    console.log('Base websocket :' + environment.socket +
      ' production? ' + environment.production);
  }
  roomId = '';
  sid = ''
  isMaster = false
  // Hàm lấy tên ngẫu nhiên
  public static randomName(): string {
    const randomIndex = Math.floor(Math.random() * names.length);
    return names[randomIndex];
  }
  private getRandomName() {
    const randomIndex = Math.floor(Math.random() * names.length);
    this.sid = names[randomIndex];
  }

  generateRoom() {
    const raw = Math.random().toString(36).substring(2, 11);
    this.roomId = raw.match(/.{1,3}/g)?.join('-') || raw;
    this.roomId = this.roomId.toUpperCase()
    this.getRandomName();
    this.isMaster = true
  }

  joinRoom() {
    if (!this.roomId.trim()) {
      alert('Please enter or generate a room ID first.');
      return;
    }
    if (!this.sid) {
      this.getRandomName()
    }
    this.router.navigate(['/webrtc-v2', this.roomId, this.sid, this.isMaster]).then(_ => { })
  }

  goToUav() {
    this.router.navigate(['/call-uav']).then(_ => { })
  }
}
