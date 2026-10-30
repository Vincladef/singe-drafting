import test from 'node:test';
import assert from 'node:assert/strict';
import { wilson,posterior,summarize } from '../server/statistics.ts';
import { Engine } from '../server/engine.ts';
import { draftSchema } from '../server/validation.ts';
import { normalizeMatch,frameAt } from '../server/ingest.ts';
import { statements } from '../scripts/prepare.ts';
import {features,predict,trainModel,type ModelArtifact} from '../server/model.ts';
import type { Champion,Draft,Game,Participant } from '../server/types.ts';
import { ROLES } from '../server/types.ts';

// Synthetic fixtures are confined to tests. Production never imports these records.
const catalog:Champion[]=Array.from({length:20},(_,i)=>({id:`C${i}`,key:String(i+1),name:`Champion ${i}`}));
function game(id:number,blueWin:boolean,offset=0):Game{
  return {id:`TEST_${id}`,patch:'16.21',platform:'EUW1',queue:420,started:Date.now()-id*1000,duration:1800,bans:['C19'],participants:[100,200].flatMap((team,t)=>ROLES.map((role,i):Participant=>({champion:`C${i+5*t+offset}`,role,team,player:`player${t}${i}`,win:t===0?blueWin:!blueWin,kills:3,deaths:2,assists:5,cs:180,damage:18000,vision:20,gold15:null,xp15:null,gd15:null,xpd15:null,kp:50,objectives:2}))) };
}
const draft:Draft={blue:['C0','C1','C2',null,null],red:['C5','C6','C7','C8','C9'],selected:{blue:[3,4],red:[]},bans:[],filter:{patch:'16.21',platform:'EUW1',queue:420,days:30,tier:'all'}};
test('Wilson interval: zero, boundary and fair coin',()=>{
  assert.equal(wilson(0,0),null);const ci=wilson(50,100)!;assert.ok(ci[0]<41&&ci[0]>40);assert.ok(ci[1]>59&&ci[1]<60);assert.ok(wilson(0,1)![1]>79);assert.ok(wilson(1,1)![0]<21);
});
test('Small perfect samples shrink more than large ones',()=>{assert.ok(posterior(2,2)<posterior(200,200));assert.equal(posterior(0,0),.5);});
test('Missing timelines remain null; per-minute and KDA formulas',()=>{
  const g=game(1,true);const s=summarize([{p:g.participants[0],g}]);assert.equal(s.gold15,null);assert.equal(s.timelineN,0);assert.equal(s.cs,6);assert.equal(s.dpm,600);assert.equal(s.kda,4);assert.equal(s.wr,100);
});
test('Collective outcomes count team-matches, never average champion winrates',()=>{
  const games=Array.from({length:100},(_,i)=>game(i,i<60));const engine=new Engine(games,catalog);
  const group=engine.collective(['C0','C1','C2','C3','C4'],draft.red);
  assert.equal(group.allies.n,100);assert.equal(group.allies.wr,60);assert.equal(group.against.n,100);assert.equal(group.probability,null);
  assert.equal(engine.group(['C1','C0',null,null,null]).n,0); // correct champions, wrong roles
  assert.equal(engine.collective(draft.blue,['C19',null,null,null,null]).against.n,0);
});
test('One through five slots: valid combinations, fixed picks, bans and opposite side',()=>{
  const games=Array.from({length:100},(_,i)=>game(i,i<60));const e=new Engine(games,catalog);
  for(let count=1;count<=5;count++){
    const d=structuredClone(draft);d.blue=Array(5).fill(null);d.selected.blue=Array.from({length:count},(_,i)=>i);
    const recommendations=e.recommend(d,'blue');assert.ok(recommendations.length>0);
    for(const r of recommendations){assert.equal(Object.keys(r.parts).length,count);assert.equal(new Set(Object.values(r.parts)).size,count);assert.ok(Object.values(r.parts).every(c=>!d.red.includes(c)));}
  }
  const d=structuredClone(draft);d.bans=['C3'];assert.equal(e.recommend(d,'blue').length,0);
  const r=e.recommend(draft,'blue')[0];assert.equal(r.parts[3],'C3');assert.equal(r.parts[4],'C4');assert.equal(r.collective.allies.n,100);
  const other={...draft,red:Array(5).fill(null),selected:{blue:[],red:[0,1,2,3,4]}};assert.ok(e.recommend(other,'red').length);
});
test('Personal stats are tied to exactly the supplied player hash',()=>{
  const e=new Engine([game(1,true),game(2,false)],catalog);
  assert.equal(e.personal('unknown','C0',0).champion.n,0);assert.equal(e.personal('player00','C0',0,'C5').matchup.n,2);assert.equal(e.personal('player00','C0',1).champion.n,0);
});
test('Champion statistics use the full aggregate even when the interaction cohort is small',()=>{
  const g=game(1,true),stat=summarize([{p:g.participants[0],g}]);
  const complete={...stat,n:120000,wins:60000,wr:50};
  const engine=new Engine([g],catalog,{'TOP:C0':complete});
  assert.equal(engine.stat('C0',0).n,120000);assert.equal(engine.stat('C0',0).wr,50);
});
test('Validation rejects duplicate champions, bans and occupied optimization slots',()=>{
  assert.ok(draftSchema.safeParse(draft).success);
  assert.equal(draftSchema.safeParse({...draft,bans:['C0']}).success,false);
  assert.equal(draftSchema.safeParse({...draft,selected:{blue:[0],red:[]}}).success,false);
});
test('Match normalization rejects remakes and ambiguous roles; no fabricated timeline',()=>{
  const g=game(1,true);const raw={metadata:{matchId:'EUW1_1'},info:{gameDuration:1800,queueId:420,gameVersion:'16.21.1',gameStartTimestamp:Date.now(),teams:[{bans:[]}],participants:g.participants.map((p,i)=>({participantId:i+1,championId:i+1,teamId:p.team,teamPosition:({MID:'MIDDLE',ADC:'BOTTOM',SUPPORT:'UTILITY'} as any)[p.role]||p.role,puuid:'test'+i,win:p.win,kills:3,deaths:2,assists:5,totalMinionsKilled:150,neutralMinionsKilled:30,totalDamageDealtToChampions:18000,visionScore:20}))}};
  const normalized=normalizeMatch(raw,'EUW1',catalog)!;assert.equal(normalized.participants[0].gold15,null);assert.notEqual(normalized.participants[0].player,'test0');
  raw.info.gameDuration=120;assert.equal(normalizeMatch(raw,'EUW1',catalog),null);
  raw.info.gameDuration=1800;raw.info.participants[0].teamPosition='';assert.equal(normalizeMatch(raw,'EUW1',catalog),null);
});
test('Migration splitter preserves PL/pgSQL blocks and quoted semicolons',()=>{assert.equal(statements("select ';'; DO $$ BEGIN perform 1; END $$; select 2;").length,3);});
test('Timeline frames tolerate recorded clock drift without accepting a missing minute',()=>{
  assert.equal(frameAt([{timestamp:840010},{timestamp:900024},{timestamp:960000}],15).timestamp,900024);
  assert.equal(frameAt([{timestamp:840010},{timestamp:960000}],15),null);
  assert.equal(frameAt(undefined,15),null);
});
test('Predictive features are antisymmetric, probabilities complement, incomplete drafts rejected',()=>{
  const b=['C0','C1','C2','C3','C4'],r=['C5','C6','C7','C8','C9'];
  const f=features(b,r),inverse=features(r,b);for(const [i,v]of f)assert.ok(Math.abs(v+(inverse.get(i)||0))<1e-10);
  const model={weights:Array.from({length:4096},(_,i)=>Math.sin(i)*.1),temperature:2,eligible:true,support:Object.fromEntries([...b,...r].map((c,i)=>[ROLES[i%5]+':'+c,30]))} as ModelArtifact;
  assert.ok(Math.abs(predict(model,b,r)!+predict(model,r,b)!-1)<1e-10);assert.equal(predict(model,[null,...b.slice(1)],r),null);
  assert.equal(predict({...model,eligible:false},b,r),null);assert.equal(trainModel([game(1,true)]),null);
});
