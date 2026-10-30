import { db, cached, cache, hash } from './db.ts';
import type { Filter, Game } from './types.ts';
export async function dataset(filter:Filter):Promise<Game[]>{
  const key=`dataset:${hash(JSON.stringify(filter))}`;const hit=await cached<Game[]>(key);if(hit)return hit;
  const rows=await db()`select m.*,(select jsonb_agg(jsonb_build_object(
    'champion',p.champion,'role',p.role,'team',p.team,'player',p.player_hash,'win',p.win,
    'kills',p.kills,'deaths',p.deaths,'assists',p.assists,'cs',p.cs,'damage',p.damage,
    'vision',p.vision,'kp',p.kp,'objectives',p.objectives,'gold15',p.gold15,'xp15',p.xp15,
    'gd15',p.gd15,'xpd15',p.xpd15,'tier',p.rank_tier)) from drafting.participants p where p.match_id=m.id) as participants
    from (select * from drafting.matches where
      (${filter.patch}='all' or patch=${filter.patch}) and (${filter.platform}='all' or platform=${filter.platform})
      and queue=${filter.queue} and started_at>now()-${filter.days}*interval '1 day'
      order by started_at desc limit 5000) m
    order by m.started_at desc`;
  // Rank means observed current tier; Match-V5 supplies no historical rank.
  const games:Game[]=rows.map(r=>({id:r.id,patch:r.patch,platform:r.platform,queue:r.queue,
    started:new Date(r.started_at).getTime(),duration:r.duration,bans:r.bans,participants:r.participants}));
  const selected=filter.tier==='all'?games:games.filter(g=>g.participants.every(p=>p.tier===filter.tier));
  await cache(key,selected,180,'Normalized Riot Match-V5; latest 5000 matching games');return selected;
}
export async function personalDataset(filter:Filter,players:string[]):Promise<Game[]>{
  if(!players.length)return [];
  const rows=await db()`select m.*,(select jsonb_agg(jsonb_build_object('champion',p.champion,'role',p.role,'team',p.team,'player',p.player_hash,'win',p.win,'kills',p.kills,'deaths',p.deaths,'assists',p.assists,'cs',p.cs,'damage',p.damage,'vision',p.vision,'kp',p.kp,'objectives',p.objectives,'gold15',p.gold15,'xp15',p.xp15,'gd15',p.gd15,'xpd15',p.xpd15,'tier',p.rank_tier)) from drafting.participants p where p.match_id=m.id) as participants
    from drafting.matches m where (${filter.patch}='all' or m.patch=${filter.patch}) and (${filter.platform}='all' or m.platform=${filter.platform}) and m.queue=${filter.queue} and m.started_at>now()-${filter.days}*interval '1 day' and exists(select 1 from drafting.participants own where own.match_id=m.id and own.player_hash=any(${players}::text[])) order by m.started_at desc limit 10000`;
  const games:Game[]=rows.map(r=>({id:r.id,patch:r.patch,platform:r.platform,queue:r.queue,started:new Date(r.started_at).getTime(),duration:r.duration,bans:r.bans,participants:r.participants}));
  return filter.tier==='all'?games:games.filter(g=>g.participants.every(p=>p.tier===filter.tier));
}
