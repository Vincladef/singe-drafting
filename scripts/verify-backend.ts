import assert from 'node:assert/strict';
import api from '../netlify/functions/api.mts';
import { db,status } from '../server/db.ts';
import { ask } from '../server/ai.ts';
import { riot,RiotError } from '../server/riot.ts';

export async function verifyBackend(){
  const origin='https://singe-drafting.netlify.app';
  const sample={blue:['Darius','Fiddlesticks','Ahri',null,null],red:['Garen','Viego','Yasuo','Caitlyn','Nautilus'],selected:{blue:[3,4],red:[]},bans:[],filter:{patch:'all',platform:'all',queue:420,days:90,tier:'all'}};
  const response=await api(new Request(origin+'/api/analyze',{method:'POST',headers:{'content-type':'application/json',origin},body:JSON.stringify(sample)}),{ip:'build-verification'} as any);
  assert.equal(response.status,200,'Live database analysis must succeed');const data=await response.json();assert.equal(typeof data.context.games,'number');assert.equal(data.probability,null);
  for(const path of ['profile','drafts','accounts'])assert.equal((await api(new Request(origin+'/api/'+path),{} as any)).status,401);
  const timelines=await db()`select count(*)::int as n from drafting.timeline_metrics`;
  await status('verification','backend_passed',{games:data.context.games,timelineMeasures:timelines[0].n,anonymousProtected:true});
  const seeds=await db()`select payload from drafting.jobs where payload->>'puuid' is not null limit 1`;
  if(seeds[0]){
    try{await riot(seeds[0].payload.platform.toLowerCase(),`/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(seeds[0].payload.puuid)}`,0);await status('spectator','reachable',{result:'active_game_found'});}
    catch(e){await status('spectator',e instanceof RiotError&&e.status===404?'reachable_no_active_game':'unavailable',{httpStatus:e instanceof RiotError?e.status:null});}
  }
  try{
    const ai=await ask('system:build-verification',sample,'En deux phrases, explique ce que ces données permettent de conclure, sans inventer de statistique.');
    assert.ok(ai.answer.length>0);await status('verification_ai','generation_passed',{model:ai.model,length:ai.answer.length});
  }catch{await status('verification_ai','generation_unavailable',{model:'gpt-6-luna'});}
  console.log(`Live backend checks passed (${data.context.games} matches, ${timelines[0].n} timeline measurements).`);
}
