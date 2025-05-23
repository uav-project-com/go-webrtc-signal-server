import {Injectable} from '@angular/core';

@Injectable({ providedIn: 'root' })
export class RoomInfo {
  public roomId: string;
  public userId: string;
}
