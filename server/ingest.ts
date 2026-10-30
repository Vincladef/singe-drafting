import { db, cached, cache, hash, status } from './db.ts';
import { riot, routing, RiotError } from './riot.ts';
import type { Champion, Game, Participant, Role } from './types.ts';
import { catalogSnapshot } from './catalog.ts';
import { randomInt } from 'node:crypto';
const roleMap:Record<string,Role>={TOP:'TOP',JUNGLE:'JUNGLE',MIDDLE:'MID',BOTTOM:'ADC',UTILITY:'SUPPORT'};
export function frameAt(frames:any[]|undefined,minute:number){
  const target=minute*60000;
  const nearest=frames?.reduce((best:any,f:any)=>!best||Math.abs(f.timestamp-target)<Math.abs(best.timestamp-target)?f:best,null);
  return nearest&&Math.abs(nearest.timestamp-target)<=5000?nearest:null;
}
export function normalizeMatch(raw:any,platform:string,catalog:Champion[],timeline?:any):Game|null{
  const info=raw.info;
  if(!info||info.gameDuration<300||![420,440].includes(info.queueId)||info.participants.length!==10)return null;
  const championByKey=new Map(catalog.map(c=>[String(c.key),c.id]));
  const frame=frameAt(timeline?.info?.frames,15);
  const participants:Participant[]=info.participants.map((p:any)=>{
    const f=frame?.participantFrames?.[p.participantId];
    const opp=info.participants.find((o:any)=>o.teamId!==p.teamId&&o.teamPosition===p.teamPosition);
    const of=opp&&frame?.participantFrames?.[opp.participantId];
    const teamKills=info.participants.filter((x:any)=>x.teamId===p.teamId).reduce((a:number,x:any)=>a+x.kills,0);
    return {champion:championByKey.get(String(p.championId))||p.championName,role:roleMap[p.teamPosition],
      team:p.teamId,player:p.puuid?hash(p.puuid):undefined,win:p.win,kills:p.kills,deaths:p.deaths,assists:p.assists,
      cs:p.totalMinionsKilled+p.neutralMinionsKilled,damage:p.totalDamageDealtToChampions,vision:p.visionScore,
      kp:teamKills?100*(p.kills+p.assists)/teamKills:0,objectives:(p.turretTakedowns||0)+(p.dragonTakedowns||0)+(p.baronTakedowns||0),
      gold15:f?.totalGold??null,xp15:f?.xp??null,gd15:f&&of?f.totalGold-of.totalGold:null,xpd15:f&&of?f.xp-of.xp:null};
  });
  if(participants.some(p=>!p.role||!championByKey.has(String(catalog.find(c=>c.id===p.champion)?.key))))return null;
  if([100,200].some(t=>new Set(participants.filter(p=>p.team===t).map(p=>p.role)).size!==5))return null;
  return {id:raw.metadata.matchId,patch:info.gameVersion.split('.').slice(0,2).join('.'),platform,queue:info.queueId,
    started:info.gameStartTimestamp,duration:info.gameDuration,participants,
    bans:info.teams.flatMap((t:any)=>t.bans.map((b:any)=>championByKey.get(String(b.championId))).filter(Boolean))};
}
export async function importMatch(id:string,platform:string,catalog:Champion[]){
  const sql=db();const existing=await sql`select timeline_status from drafting.matches where id=${id}`;
  if(existing[0]?.timeline_status==='complete')return false;
  const raw=await riot(routing(platform),`/lol/match/v5/matches/${encodeURIComponent(id)}`,0);
  let timeline:any,timelineStatus='pending';
  try{timeline=await riot(routing(platform),`/lol/match/v5/matches/${encodeURIComponent(id)}/timeline`,0);timelineStatus='complete';}catch(e){if(e instanceof RiotError&&[401,403,429].includes(e.status))throw e;if(e instanceof RiotError&&e.status===404)timelineStatus='unavailable';}
  const game=normalizeMatch(raw,platform,catalog,timeline);if(!game)return false;
  if(timeline)await status('timeline','reachable',{frames:timeline.info?.frames?.length||0,firstTimes:(timeline.info?.frames||[]).slice(0,3).map((f:any)=>f.timestamp),sampled15:frameAt(timeline.info?.frames,15)?.timestamp??null});
  const queries=[sql`insert into drafting.matches(id,patch,platform,queue,started_at,duration,bans,timeline_status)
    values(${game.id},${game.patch},${game.platform},${game.queue},${new Date(game.started).toISOString()},${game.duration},${JSON.stringify(game.bans)}::jsonb,${timelineStatus})
    on conflict(id) do update set timeline_status=excluded.timeline_status`];
  for(let i=0;i<game.participants.length;i++){
    const p=game.participants[i];
    queries.push(sql`insert into drafting.participants(match_id,participant_id,player_hash,champion,role,team,win,kills,deaths,assists,cs,damage,vision,kp,objectives,gold15,xp15,gd15,xpd15)
      values(${id},${i+1},${p.player||''},${p.champion},${p.role},${p.team},${p.win},${p.kills},${p.deaths},${p.assists},${p.cs},${p.damage},${p.vision},${p.kp},${p.objectives},${p.gold15},${p.xp15},${p.gd15},${p.xpd15})
      on conflict(match_id,participant_id) do update set gold15=excluded.gold15,xp15=excluded.xp15,gd15=excluded.gd15,xpd15=excluded.xpd15`);
  }
  for(const minute of [5,10,15,20]){
    const f=frameAt(timeline?.info?.frames,minute);if(!f)continue;
    for(const p of Object.values(f.participantFrames) as any[])queries.push(sql`insert into drafting.timeline_metrics(match_id,participant_id,minute,gold,xp,cs,sampled_at_ms) values(${id},${p.participantId},${minute},${p.totalGold},${p.xp},${p.minionsKilled+p.jungleMinionsKilled},${f.timestamp}) on conflict do nothing`);
  }
  queries.push(sql`insert into drafting.patches(patch) values(${game.patch}) on conflict do nothing`);
  await sql.transaction(queries);
  return true;
}
export async function refreshAccount(account:any){
  const [rank,mastery]=await Promise.all([
    riot(account.platform.toLowerCase(),`/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`,1800),
    riot(account.platform.toLowerCase(),`/lol/champion-mastery/v4/champion-masteries/by-puuid/${encodeURIComponent(account.puuid)}/top?count=12`,3600)
  ]);
  await db()`update drafting.riot_accounts set rank_data=${JSON.stringify(rank)}::jsonb,mastery=${JSON.stringify(mastery)}::jsonb,refreshed_at=now() where id=${account.id}`;
  const solo=rank.find((r:any)=>r.queueType==='RANKED_SOLO_5x5');
  if(solo)await db()`update drafting.participants set rank_tier=${solo.tier},rank_observed_at=now() where player_hash=${hash(account.puuid)}`;
}
export async function collect(limit=4,eager=false){
  const sql=db();const catalog=(await catalogSnapshot()).champions;
  if(!catalog?.length)return {imported:0,reason:'catalog_unavailable'};
  const missing=await sql`select id,platform from drafting.matches where timeline_status='pending' order by imported_at limit ${Math.min(limit,5)}`;
  if(missing.length){
    try{let repaired=0;for(const m of missing)if(await importMatch(m.id,m.platform,catalog))repaired++;return {imported:0,repaired};}
    catch(e){return {imported:0,reason:e instanceof RiotError?`RIOT_${e.status}`:'TIMELINE_RETRY_FAILED'};}
  }
  const jobRows=await sql`update drafting.jobs set status='running',lease_until=now()+interval '3 minutes',attempts=attempts+1
    where key=(select key from drafting.jobs where (status='pending' or status='running' and lease_until<now()) and (available_at<=now() or ${eager} and last_error is null) order by case when kind='player' then 0 else 1 end,updated_at limit 1 for update skip locked) returning *`;
  let job=jobRows[0];
  let imported=0;
  try{
    if(!job){
      // Breadth first: small histories from many players across region/rank/division strata.
      // The strata are not population-weighted, so this still must not be called a world census.
      const platforms=['EUW1','EUN1','NA1','KR','BR1'],tiers=['IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND'];
      const platform=platforms[randomInt(platforms.length)],tier=tiers[randomInt(tiers.length)],division=['I','II','III','IV'][randomInt(4)],page=randomInt(1,5);
      const entries=await riot(platform.toLowerCase(),`/lol/league/v4/entries/RANKED_SOLO_5x5/${tier}/${division}?page=${page}`,3600);
      const entry=entries[randomInt(Math.max(1,entries.length))];if(!entry?.puuid)return {imported:0,reason:'no_seed_puuid'};
      const jobKey=`cohort:${hash(entry.puuid+platform)}`;
      const inserted=await sql`insert into drafting.jobs(key,kind,payload,status,lease_until) values(${jobKey},'cohort',${JSON.stringify({puuid:entry.puuid,platform,tier,division,page})}::jsonb,'running',now()+interval '3 minutes') on conflict do nothing returning *`;
      if(!inserted[0])return {imported:0,reason:'cohort_already_sampled'};job=inserted[0];
    }
    const {puuid,platform,accountId}=job.payload;
    const lookback=job.kind==='cohort'?30:90;
    const startTime=Math.floor((Date.now()-lookback*86400000)/1000);
    const count=job.kind==='cohort'?5:100;
    const ids=await riot<string[]>(routing(platform),`/lol/match/v5/matches/by-puuid/${encodeURIComponent(puuid)}/ids?start=0&count=${count}&type=ranked&startTime=${startTime}`,300);
    for(const id of ids.slice(job.cursor,job.cursor+limit)){if(await importMatch(id,platform,catalog))imported++;}
    const cursor=job.cursor+limit,done=cursor>=ids.length;
    await sql`update drafting.jobs set status=${done?'complete':'pending'},cursor=${cursor},lease_until=null,available_at=now()+interval '5 minutes',updated_at=now(),last_error=null where key=${job.key}`;
    if(accountId){const a=await sql`select * from drafting.riot_accounts where id=${accountId}`;if(a[0]&&(!a[0].refreshed_at||Date.now()-new Date(a[0].refreshed_at).getTime()>1800000))await refreshAccount(a[0]);}
    if(imported)await sql`delete from drafting.cache where key like 'dataset:%' or key like 'aggregates:%'`;
    await status('collector','ready',{imported,lastRun:new Date().toISOString(),sampling:'ladder and declared accounts; nonrepresentative'});
    return {imported};
  }catch(e){
    const code=e instanceof RiotError?`RIOT_${e.status}`:'IMPORT_FAILED';
    const delay=e instanceof RiotError&&e.status===429?Math.max(5,e.retryAfter):e instanceof RiotError&&[401,403].includes(e.status)?3600:120;
    if(job)await sql`update drafting.jobs set status='pending',last_error=${code},lease_until=null,available_at=now()+${delay}*interval '1 second',updated_at=now() where key=${job.key}`;
    await status('collector',code,{imported});return {imported,reason:code};
  }
}
