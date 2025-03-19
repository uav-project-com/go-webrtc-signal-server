export interface Message {
  channel?: string;
  from?: string;
  // When peers are more than two, no need `to`, just send broadcast except send to `from` userId
  to?: string;
  msg: string;
  roomId?: string;
}
