import { randomUUID } from 'node:crypto';
import { db,cache,status } from './db.ts';
import { withOpgg } from './opgg-client.ts';
import { championCode,championId,lane,mergeAnalysis,role,type GameMode,type OpggSnapshot } from './opgg-data.ts';
import { ROLES,type Champion,type Role } from './types.ts';
import { catalogSnapshot } from './catalog.ts';
export const SNAPSHOT_SECONDS=21600;
const fields=['champion','position','data.summary.average_stats.{ban_rate,kda,pick_rate,play,win_rate}','data.summary.positions[].name','data.summary.positions[].stats.{ban_rate,kda,pick_rate,play,role_rate,win_rate}','data.summary.positions[].counters[].{champion_id,champion_name,play,win}','data.strong_counters[].{champion_id,champion_name,my_win_rate,counter_win_rate,play,win,win_rate}','data.weak_counters[].{champion_id,champion_name,my_win_rate,counter_win_rate,play,win,win_rate}',...['jungle','mid','adc','support'].map(p=>`data.synergies.${p}[].{champion_id,champion_name,play,position,synergy_champion_id,synergy_champion_name,synergy_position,win,win_rate}`),'data.trends.win.{created_at,rate,version}'];
export const analysisArgs=(c:Champion,r:Role,mode:GameMode)=>({game_mode:mode,champion:championCode(c),position:lane(r),lang:'en_US',desired_output_fields:fields}); // tier intentionally omitted: official All Tiers contract
export function emptySnapshot(champions:Champion[],mode:GameMode):OpggSnapshot{return {version:1,champions,stats:{},matchups:{},synergies:{},completed:[],failures:[],context:{source:'OP.GG MCP',mode,tier:'all',tierVerified:true,region:null,regionVerified:false,requestedRegion:'global',patch:null,upstreamUpdatedAt:null,fetchedAt:new Date().toISOString()}};}
export async function snapshot(mode:GameMode):Promise<OpggSnapshot>{
  // Durable last known snapshot: stale responses are explicitly labelled, never silently discarded.
  const rows=await db()`select value from drafting.cache where key=${'opgg:snapshot:'+mode}`;
  return rows[0]?.value||emptySnapshot((await catalogSnapshot()).champions,mode);
}
export async function providerCatalog(){return withOpgg(async call=>{
  const value=await call('lol_list_champions',{lang:'en_US',desired_output_fields:['data.champions[].{champion_id,key,name}']});
  const champions:Champion[]=(value.data?.champions||[]).map((r:any)=>({id:r.key,key:String(r.champion_id),name:r.name})).filter((c:Champion)=>/^[A-Za-z0-9]+$/.test(c.id));
  if(champions.length<100)throw new Error('OPGG_INVALID_CATALOG');
  await cache('opgg:catalog',{champions},30*86400,'OP.GG MCP');return champions;
});}
export async function refreshProvider(mode:GameMode='ranked',maxMs=480000){
  const owner=randomUUID(),leaseName='opgg:'+mode;
  const lease=await db()`insert into drafting.worker_leases(name,owner,expires_at) values(${leaseName},${owner},now()+interval '12 minutes') on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at where drafting.worker_leases.expires_at<now() returning owner`;
  if(!lease.length)return {busy:true};
  const start=Date.now(),previous=await snapshot(mode);let s=previous;
  const save=async()=>{
    if(!s.completed.length)return;
    await cache('opgg:working:'+mode,s,86400,'OP.GG MCP');
    // Build a replacement separately: normal refresh must not turn a complete corpus into ten champions.
    if(s.completed.length>=previous.completed.length*.95)await cache('opgg:snapshot:'+mode,s,7*86400,'OP.GG MCP');
  };
  try{return await withOpgg(async call=>{
    const current=await db()`select value from drafting.cache where key='opgg:catalog'`;
    const champions:Champion[]=current[0]?.value?.champions||previous.champions;
    if(!champions.length)throw new Error('OPGG_NO_CATALOG');
    if(Date.now()-Date.parse(previous.context.fetchedAt)<SNAPSHOT_SECONDS*1000&&previous.completed.length>=champions.length*.95)return {cached:true,completed:previous.completed.length};
    const work=await db()`select value from drafting.cache where key=${'opgg:working:'+mode} and expires_at>now()`;
    s=work[0]?.value&&Date.now()-Date.parse(work[0].value.context.fetchedAt)<SNAPSHOT_SECONDS*1000?work[0].value:emptySnapshot(champions,mode);
    s.champions=champions;
    const meta=await call('lol_list_lane_meta_champions',{position:'all',lang:'en_US',desired_output_fields:ROLES.map(r=>`data.positions.${lane(r)}[].{champion,play}`)});
    const primary=new Map<string,{role:Role;n:number}>();
    for(const [pos,rows]of Object.entries(meta.data?.positions||{}) as [string,any[]][]){const r=role(pos);if(!r)continue;for(const row of rows||[]){const id=championId(champions,row.champion);if(id&&(!primary.has(id)||row.play>primary.get(id)!.n))primary.set(id,{role:r,n:row.play});}}
    let changed=0,errors=0;
    const queue=champions.filter(c=>!s.completed.includes(c.id)).sort((a,b)=>(primary.get(b.id)?.n||0)-(primary.get(a.id)?.n||0));
    for(const c of queue){if(Date.now()-start>maxMs)break;
      try{mergeAnalysis(s,c,primary.get(c.id)?.role||'MID',await call('lol_get_champion_analysis',analysisArgs(c,primary.get(c.id)?.role||'MID',mode)));changed++;}
      catch{s.failures=[...new Set([...s.failures,c.id])];errors++;if(errors>=5)break;}
      if(changed%10===0)await save();
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    await save();await status('opgg','ready',{mode,champions:s.completed.length,total:champions.length,matchups:Object.keys(s.matchups).length,synergies:Object.keys(s.synergies).length,failures:s.failures,context:s.context,requestsThisRun:changed+errors+1});
    return {changed,errors,completed:s.completed.length,total:champions.length};
  });}catch{await status('opgg','unavailable',{mode,retainedChampions:previous.completed.length,lastSuccess:previous.context.fetchedAt});return {unavailable:true,completed:previous.completed.length};}
  finally{await db()`delete from drafting.worker_leases where name=${leaseName} and owner=${owner}`;}
}
