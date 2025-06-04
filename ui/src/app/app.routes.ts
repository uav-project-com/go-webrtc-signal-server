import {Routes} from '@angular/router';
import {CallComponent} from './call/call.component';
import {CallComponentV2} from './callv2/call.component';
import {HomeComponent} from './home/home.component';

export const routes: Routes = [
  { path: '', redirectTo: '/home', pathMatch: 'full' },
  {path: 'home', component: HomeComponent},
  {path: 'call', component: CallComponent},
  {path: 'webrtc-v2/:roomId/:sid/:isJoiner', component: CallComponentV2},
];
