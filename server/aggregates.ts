import { db,cached,cache,hash } from './db.ts';
import { wilson,reliability } from './statistics.ts';
import type { Filter,Stat } from './types.ts';
const context=`($1='all' or m.patch=$1) and ($2='all' or m.platform=$2) and m.queue=$3 and m.started_at>now()-$4*interval '1 day' and ($5='all' or not exists(select 1 from drafting.participants rp where rp.match_id=m.id and rp.rank_tier is distinct from $5))`;
export async function fullAggregates(filter:Filter){
  const cacheKey=`aggregates:${hash(JSON.stringify(filter))}`;
  const hit=await cached<{games:number;stats:Record<string,Stat>}>(cacheKey);if(hit)return hit;
  const sql=db(),params=[filter.patch,filter.platform,filter.queue,filter.days,filter.tier];
  const [totals,rows,bans]=await Promise.all([
    sql.query(`select count(*)::int as games from drafting.matches m where ${context}`,params),
    sql.query(`select p.champion,case when grouping(p.role)=1 then 'all' else p.role end as role,count(*)::int as n,sum(p.win::int)::int as wins,sum(p.kills+p.assists)::float as ka,sum(p.deaths)::float as deaths,avg(p.cs/(m.duration/60.0))::float as cs,avg(p.damage/(m.duration/60.0))::float as dpm,avg(p.vision)::float as vision,avg(p.kp)::float as kp,avg(p.objectives)::float as objectives,avg(p.gold15)::float as gold15,avg(p.gd15)::float as gd15,avg(p.xp15)::float as xp15,avg(p.xpd15)::float as xpd15,count(p.gold15)::int as timeline_n from drafting.matches m join drafting.participants p on p.match_id=m.id where ${context} group by grouping sets((p.champion,p.role),(p.champion))`,params),
    sql.query(`select b.champion,count(*)::int as n from drafting.matches m cross join lateral jsonb_array_elements_text(m.bans) as b(champion) where ${context} group by b.champion`,params)
  ]);
  const games=Number(totals[0]?.games||0),banCounts=new Map(bans.map(r=>[r.champion,Number(r.n)])),stats:Record<string,Stat>={};
  for(const r of rows){const n=Number(r.n),wins=Number(r.wins);stats[r.role==='all'?r.champion:`${r.role}:${r.champion}`]={
    n,wins,wr:100*wins/n,interval:wilson(wins,n),reliability:reliability(n),kda:r.ka/Math.max(1,r.deaths),cs:r.cs,dpm:r.dpm,vision:r.vision,kp:r.kp,objectives:r.objectives,gold15:r.gold15,gd15:r.gd15,xp15:r.xp15,xpd15:r.xpd15,timelineN:r.timeline_n,pick:games?100*n/games:null,ban:games?100*(banCounts.get(r.champion)||0)/games:null
  };}
  const value={games,stats};await cache(cacheKey,value,180,'Full collected Riot cohort; no 5000-game truncation');return value;
}
