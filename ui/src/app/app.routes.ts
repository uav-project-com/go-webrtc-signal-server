import { Routes } from '@angular/router';
import { CallComponentV2 } from './callv2/call.component';
import { CallUavComponent } from './call-uav/call-uav.component';
import { HomeComponent } from './home/home.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  { path: 'home', component: HomeComponent },
  { path: 'webrtc-v2/:roomId', component: CallComponentV2 },
  { path: 'webrtc-v2/:roomId/:sid/:isMaster', component: CallComponentV2 },
  { path: 'call-uav', component: CallUavComponent },
];
