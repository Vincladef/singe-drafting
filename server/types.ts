export const ROLES = ['TOP','JUNGLE','MID','ADC','SUPPORT'] as const;
export type Role = typeof ROLES[number];
export type Side = 'blue'|'red';
export interface Champion { id:string; key?:string; name:string; tags?:string[]; roles?:Role[] }
export interface Participant {
  champion:string; role:Role; team:number; player?:string; win:boolean;
  kills:number; deaths:number; assists:number; cs:number; damage:number;
  vision:number; gold15:number|null; xp15:number|null; gd15:number|null; xpd15:number|null;
  kp:number; objectives:number; tier?:string|null;
}
export interface Game {
  id:string; patch:string; platform:string; queue:number; started:number; duration:number;
  participants:Participant[]; bans:string[];
}
export interface Filter { patch:string; platform:string; queue:number; days:number; tier:string }
export interface Draft {
  blue:(string|null)[]; red:(string|null)[];
  selected:{blue:number[];red:number[]}; bans:string[];
  players?:{side:Side;slot:number;accountId:string}[];
  publicPlayers?:{side:Side;slot:number;riotId:string;platform:string}[];
  filter:Filter;
}
export interface Stat {
  n:number|null; wins:number|null; wr:number|null; interval:[number,number]|null;
  kda:number|null; cs:number|null; dpm:number|null; vision:number|null;
  gold15:number|null; gd15:number|null; xp15:number|null; xpd15:number|null;
  timelineN:number; kp:number|null; objectives:number|null;
  pick:number|null; ban:number|null; reliability:'absente'|'faible'|'moyenne'|'élevée';
}
