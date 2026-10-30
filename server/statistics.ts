import type { Game, Participant, Stat } from './types.ts';

export function wilson(wins:number,n:number):[number,number]|null {
  if(!n)return null;
  const z=1.959963984540054,p=wins/n,d=1+z*z/n;
  const c=(p+z*z/(2*n))/d,h=z*Math.sqrt(p*(1-p)/n+z*z/(4*n*n))/d;
  return [100*(c-h),100*(c+h)];
}
export function reliability(n:number|null):Stat['reliability'] { return n!==null&&n>=1000?'élevée':n!==null&&n>=100?'moyenne':n?'faible':'absente'; }
export function summarize(rows:{p:Participant;g:Game}[],totalGames=0,bans=0):Stat {
  const n=rows.length,wins=rows.filter(x=>x.p.win).length;
  const avg=(fn:(p:Participant,g:Game)=>number|null)=>{
    const values=rows.map(x=>fn(x.p,x.g)).filter((x):x is number=>x!==null&&Number.isFinite(x));
    return values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  };
  const sum=(k:'kills'|'assists'|'deaths')=>rows.reduce((a,{p})=>a+p[k],0);
  return {n,wins,wr:n?100*wins/n:null,interval:wilson(wins,n),reliability:reliability(n),
    kda:n?(sum('kills')+sum('assists'))/Math.max(1,sum('deaths')):null,
    cs:avg((p,g)=>p.cs/(g.duration/60)),dpm:avg((p,g)=>p.damage/(g.duration/60)),
    gold15:avg(p=>p.gold15),gd15:avg(p=>p.gd15),xp15:avg(p=>p.xp15),xpd15:avg(p=>p.xpd15),
    timelineN:rows.filter(x=>x.p.gold15!==null).length,vision:avg(p=>p.vision),
    kp:avg(p=>p.kp),objectives:avg(p=>p.objectives),
    pick:totalGames?100*n/totalGames:null,ban:totalGames?100*bans/totalGames:null};
}
// A shrinkage estimate is used ONLY for a ranking score, never as a draft probability.
export function posterior(wins:number|null,n:number|null,prior=.5,strength=60) { return wins===null||n===null?prior:(wins+strength*prior)/(n+strength); }
export function logit(p:number){const q=Math.min(.995,Math.max(.005,p));return Math.log(q/(1-q));}
export function observed(wins:number,n:number){return {kind:'observed' as const,n,wins,wr:n?100*wins/n:null,interval:wilson(wins,n),reliability:reliability(n)};}
