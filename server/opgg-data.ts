import type { Champion,Role,Stat } from './types.ts';
import { ROLES } from './types.ts';
import { wilson,reliability } from './statistics.ts';
export type GameMode='ranked'|'flex';
export interface ProviderContext {source:'OP.GG MCP';mode:GameMode;tier:'all';tierVerified:true;region:null;regionVerified:false;requestedRegion:'global';patch:string|null;upstreamUpdatedAt:string|null;fetchedAt:string;}
export interface OpggSnapshot {version:1;context:ProviderContext;champions:Champion[];stats:Record<string,Stat>;matchups:Record<string,Stat>;synergies:Record<string,Stat>;completed:string[];failures:string[];}
export const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
export const token=(role:Role,champion:string)=>`${role}:${champion}`;
export const pairKey=(a:string,b:string)=>[a,b].sort().join('|');
export const lane=(r:Role)=>r.toLowerCase();
export const role=(s:unknown):Role|null=>{const v=String(s).toUpperCase();return ROLES.includes(v as Role)?v as Role:null;};
export function championId(catalog:Champion[],name:unknown,id?:unknown){return catalog.find(c=>String(c.key)===String(id)&&id!=null||norm(c.id)===norm(String(name))||norm(c.name)===norm(String(name)))?.id||null;}
export function championCode(c:Champion){return c.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/&/g,' ').replace(/[^a-z0-9]+/gi,'_').replace(/^_|_$/g,'').toUpperCase();}
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const metric=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function publishedStat(raw:any):Stat{
  const n=count(raw?.play),reportedWins=count(raw?.win),wins=n!==null&&reportedWins!==null&&reportedWins<=n?reportedWins:null;
  const rate=metric(raw?.win_rate),fraction=rate!==null&&rate>=0&&rate<=1?rate:null;
  const percentage=(v:unknown)=>{const x=metric(v);return x!==null&&x>=0&&x<=1?100*x:null;};
  return {n,wins,wr:n&&wins!==null?100*wins/n:fraction===null?null:100*fraction,interval:n&&wins!==null?wilson(wins,n):null,
    reliability:reliability(n),kda:metric(raw?.kda),pick:percentage(raw?.pick_rate),ban:percentage(raw?.ban_rate),cs:null,dpm:null,vision:null,gold15:null,xp15:null,gd15:null,xpd15:null,kp:null,objectives:null,timelineN:0};
}
export function mergeAnalysis(snapshot:OpggSnapshot,champion:Champion,requestedRole:Role,payload:any){
  const data=payload.data;if(!data?.summary)throw new Error('OPGG_MISSING_SUMMARY');
  if(data.summary.average_stats)snapshot.stats[champion.id]=publishedStat(data.summary.average_stats);
  for(const p of data.summary.positions||[]){const r=role(p.name);if(!r)continue;
    snapshot.stats[token(r,champion.id)]=publishedStat(p.stats);
    for(const row of p.counters||[]){const other=championId(snapshot.champions,row.champion_name,row.champion_id);if(other)snapshot.matchups[`${token(r,champion.id)}>${token(r,other)}`]=publishedStat(row);}
  }
  for(const [kind,list]of [['strong',data.strong_counters],['weak',data.weak_counters]] as const)for(const row of list||[]){
    const other=championId(snapshot.champions,row.champion_name,row.champion_id);if(!other)continue;
    // Some provider responses disagree with the documented orientation of `win`.
    // Keep exact counts only when they agree with the explicit selected-champion rate.
    const n=count(row.play),wins=count(row.win),rate=metric(row.my_win_rate);
    const agrees=(w:number)=>!!n&&rate!==null&&Math.abs(w/n-rate)<=.0051;
    const ourWins=wins!==null&&agrees(wins)?wins:n!==null&&wins!==null&&agrees(n-wins)?n-wins:null;
    snapshot.matchups[`${token(requestedRole,champion.id)}>${token(requestedRole,other)}`]=publishedStat({...row,win:ourWins,win_rate:row.my_win_rate});
  }
  for(const rows of Object.values(data.synergies||{}) as any[][])for(const row of rows||[]){
    const a=championId(snapshot.champions,row.champion_name,row.champion_id),b=championId(snapshot.champions,row.synergy_champion_name,row.synergy_champion_id),ar=role(row.position),br=role(row.synergy_position);
    if(a&&b&&ar&&br)snapshot.synergies[pairKey(token(ar,a),token(br,b))]=publishedStat(row);
  }
  const trend=data.trends?.win;if(trend?.version)snapshot.context.patch=String(trend.version);
  if(trend?.created_at)snapshot.context.upstreamUpdatedAt=trend.created_at;
  snapshot.completed=[...new Set([...snapshot.completed,champion.id])];snapshot.failures=snapshot.failures.filter(x=>x!==champion.id);
}
