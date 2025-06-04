import {Routes} from '@angular/router';
import {CallComponent} from './call/call.component';
import {CallComponentV2} from './callv2/call.component';

export const routes: Routes = [
  {path: 'call', component: CallComponent},
  {path: 'webrtc-v2', component: CallComponentV2},
];
