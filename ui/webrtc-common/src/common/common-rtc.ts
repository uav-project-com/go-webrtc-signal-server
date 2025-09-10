import {SignalMsg} from '../dto/SignalMsg';

export class CommonRtc {
  public static isSignalMsg(obj: any): obj is SignalMsg {
    return (
      obj !== null &&
      typeof obj === 'object' &&
      typeof obj.from === 'string' &&
      'msg' in obj
    )
  }
}
