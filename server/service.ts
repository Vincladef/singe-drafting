import { db, cached, hash } from './db.ts';
import { dataset,personalDataset } from './dataset.ts';
import { fullAggregates } from './aggregates.ts';
import { Engine } from './engine.ts';
import type { Champion, Draft } from './types.ts';
import { HttpError } from './auth.ts';
import { predict,type ModelArtifact } from './model.ts';
import { catalogSnapshot } from './catalog.ts';
export const catalog=catalogSnapshot;
export async function analyze(draft:Draft,user:string|null){
  const cat=await catalog();
  const ids=new Set(cat.champions.map(c=>c.id));
  if([...draft.blue,...draft.red,...draft.bans].some(c=>c&&!ids.has(c)))throw new HttpError(400,'Champion inconnu dans le catalogue officiel.');
  const players:{blue:Record<number,string>;red:Record<number,string>}={blue:{},red:{}};
  if(draft.players?.length){
    if(!user)throw new HttpError(401,'Connexion requise pour les statistiques personnelles.');
    const rows=await db()`select id,puuid from drafting.riot_accounts where user_id=${user}`;
    for(const p of draft.players){const a=rows.find(r=>r.id===p.accountId);if(!a)throw new HttpError(403,'Compte indisponible.');players[p.side][p.slot]=hash(a.puuid);}
  }
  const [common,personal,aggregated]=await Promise.all([dataset(draft.filter),personalDataset(draft.filter,[...Object.values(players.blue),...Object.values(players.red)]),fullAggregates(draft.filter)]);
  const games=[...new Map([...common,...personal].map(g=>[g.id,g])).values()];
  const engine=new Engine(games,cat.champions,aggregated.stats);
  const result=engine.analyze(draft,players) as ReturnType<Engine['analyze']> & {model?:unknown};
  result.context.games=aggregated.games;
  Object.assign(result.context,{scope:'collected_sample',globalProvider:false,representative:false,interactionGames:games.length,recommendationMinimum:30});
  if(draft.filter.platform==='all'&&draft.filter.tier==='all'&&draft.filter.patch!=='all'&&draft.filter.days===30){
    const rows=await db()`select id,version,artifact,metrics from drafting.models where active=true and context->>'patch'=${draft.filter.patch} and (context->>'queue')::int=${draft.filter.queue} and created_at>now()-interval '8 days' order by created_at desc limit 1`;
    if(rows[0]){
      const model=rows[0].artifact as ModelArtifact,p=predict(model,draft.blue,draft.red);
      if(p!==null){
        (result as any).probability=p;(result.collective.blue as any).probability=p;(result.collective.red as any).probability=1-p;result.modelStatus='validated';result.model={version:rows[0].version,metrics:rows[0].metrics};
        await db()`insert into drafting.predictions(model_id,draft_hash,probability,context) values(${rows[0].id},${hash(JSON.stringify({blue:draft.blue,red:draft.red,filter:draft.filter}))},${p},${JSON.stringify(draft.filter)}::jsonb) on conflict(model_id,draft_hash) do nothing`;
      }
      for(const side of ['blue','red'] as const)for(const combo of result.recommendations[side]){
        const team=draft[side].slice();for(const [slot,champion]of Object.entries(combo.parts))team[+slot]=champion;
        const probability=predict(model,team,draft[side==='blue'?'red':'blue']);if(probability!==null)(combo.collective as any).probability=probability;
      }
      for(const side of ['blue','red'] as const)result.recommendations[side].sort((a,b)=>((b.collective as any).probability??-1)-((a.collective as any).probability??-1));
    }
  }
  return {result,engine};
}
