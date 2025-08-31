import {Injectable} from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RoomInfo {
  public roomId: string;
  public userId: string;
}

@Injectable({ providedIn: 'root' })
export class CallBackInfo {
  public context: any
  public uiControlCallback: any;
  public videoHandlerCallback: any;
}
