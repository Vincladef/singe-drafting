import test from 'node:test';
import assert from 'node:assert/strict';
import { wilson } from '../server/statistics.ts';
import { Engine,strength } from '../server/engine.ts';
import { draftSchema } from '../server/validation.ts';
import { statements } from '../scripts/prepare.ts';
import { emptySnapshot,analysisArgs } from '../server/opgg-store.ts';
import { mergeAnalysis,publishedStat,pairKey } from '../server/opgg-data.ts';
import { parseOpggText } from '../server/opgg-format.ts';
import { normalizeProfile } from '../server/opgg-player.ts';
import type { Champion,Draft } from '../server/types.ts';
import { ROLES } from '../server/types.ts';
// Artificial aggregates are confined to tests; runtime never imports this module.
const catalog:Champion[]=Array.from({length:20},(_,i)=>({id:`C${i}`,key:String(i+1),name:`Champion ${i}`}));
const draft:Draft={blue:['C0','C1','C2',null,null],red:['C5','C6','C7','C8','C9'],selected:{blue:[3,4],red:[]},bans:[],filter:{patch:'all',platform:'all',queue:420,days:30,tier:'all'}};
function sample(){const s=emptySnapshot(catalog,'ranked');for(let i=0;i<20;i++){s.stats[`C${i}`]=publishedStat({play:10000,win:5100});for(const r of ROLES)s.stats[`${r}:C${i}`]=publishedStat({play:1000,win:510+i});}return s;}
test('Wilson and shrinkage retain uncertainty',()=>{assert.equal(wilson(0,0),null);assert.ok(wilson(50,100)![0]<41);assert.ok(strength(publishedStat({play:2,win:2}))<strength(publishedStat({play:200,win:200})));});
test('Published rounded rates never fabricate exact wins, intervals, unique match totals or missing metrics',()=>{
 const s=publishedStat({play:169531,win_rate:.51,pick_rate:.1,ban_rate:.03,kda:2.56});assert.equal(s.n,169531);assert.equal(s.wr,51);assert.equal(s.wins,null);assert.equal(s.interval,null);assert.equal(s.pick,10);assert.equal(s.gd15,null);
 assert.equal(publishedStat({win_rate:.52}).n,null);assert.equal(publishedStat({win_rate:52}).wr,null);assert.equal(publishedStat({play:100,win:52}).wr,52);
 const result=new Engine(sample()).analyze(draft);assert.equal(result.context.games,null);assert.equal(result.context.regionVerified,false);assert.equal(result.probability,null);
});
test('Safe compact MCP grammar accepts declared records and rejects executable input',()=>{
 assert.deepEqual(parseOpggText('class Result: data\nclass Row: name,play\n\nResult([Row("Ahri",169531)])'),{data:[{name:'Ahri',play:169531}]});
 for(const bad of ['process.exit()','class R: __proto__\n\nR({})','class R: value\n\nR(unknown(1))','class R: a\n\nR(1,2)','class R: a\n\nR(1);attack()'])assert.throws(()=>parseOpggText(bad));
});
test('Counter orientation follows selected-champion rate when raw win field is ambiguous',()=>{
 const s=sample();mergeAnalysis(s,catalog[0],'MID',{data:{summary:{positions:[]},weak_counters:[{champion_id:2,champion_name:'C1',play:100,win:48,my_win_rate:.48,counter_win_rate:.52}]}});
 assert.equal(s.matchups['MID:C0>MID:C1'].wins,48);assert.equal(s.matchups['MID:C0>MID:C1'].wr,48);
});
test('Duos are observed directly; trios and full compositions remain unavailable',()=>{
 const s=sample();s.synergies[pairKey('ADC:C3','SUPPORT:C4')]=publishedStat({play:1000,win:560});const e=new Engine(s);
 assert.equal(e.group([null,null,null,'C3','C4']).wr,56);assert.equal(e.group(['C0',null,null,'C3','C4']).wr,null);assert.equal(e.collective(draft.blue,draft.red).against.n,null);
 assert.equal(e.collective(['C0',null,null,'C3','C4'],draft.red).duos[0].stat.wr,56);
});
test('One to five optimization slots retain three valid suggestions with bans and opposite picks',()=>{
 const e=new Engine(sample());for(let n=1;n<=5;n++){const d=structuredClone(draft);d.blue=Array(5).fill(null);d.selected.blue=Array.from({length:n},(_,i)=>i);d.bans=['C19'];const recommendations=e.recommend(d,'blue');assert.equal(recommendations.length,3);for(const r of recommendations){const ids=Object.values(r.parts);assert.equal(ids.length,n);assert.equal(new Set(ids).size,n);assert.ok(ids.every(c=>!d.red.includes(c)&&!d.bans.includes(c!)));assert.equal(r.collective.probability,null);}}
 assert.equal(e.recommend({...draft,selected:{blue:[],red:[]}},'blue').length,0);
});
test('Context arguments request All Tiers without inventing a region API parameter',()=>{const a=analysisArgs(catalog[0],'MID','ranked');assert.equal('tier' in a,false);assert.equal('region' in a,false);assert.equal(a.game_mode,'ranked');});
test('Personal aggregates are season-labelled, separate from general stats and reject fuzzy identity matches',()=>{
 const raw={data:{summoner:{game_name:'Visible',tagline:'TAG',most_champions:{play:100,win:54,game_type:'RANKED',season_id:33,champion_stats:[{id:1,play:10,win:6,kill:30,assist:40,death:20,game_length_second:18000,minion_kill:1000,neutral_minion_kill:0,damage_dealt_to_champions:150000}]}}}};
 const p=normalizeProfile(raw,{game_name:'Visible',tag_line:'TAG'},catalog),e=new Engine(sample(),{owner:p});assert.equal(p.overall.wr,54);assert.equal(p.champions[0].stat.kda,3.5);assert.equal(p.context.roleAvailable,false);assert.equal(e.personal('owner','C0',0).champion.wr,60);assert.equal(e.personal('other','C0',0).champion.wr,null);assert.equal(e.stat('C0').wr,51);
 assert.throws(()=>normalizeProfile(raw,{game_name:'Visible',tag_line:'TA G'},catalog));
});
test('Validation blocks duplicates, occupied slots and excessive controls',()=>{assert.ok(draftSchema.safeParse(draft).success);assert.equal(draftSchema.safeParse({...draft,bans:['C0']}).success,false);assert.equal(draftSchema.safeParse({...draft,selected:{blue:[0],red:[]}}).success,false);});
test('Migration splitter preserves SQL blocks',()=>{assert.equal(statements("select ';'; DO $$ BEGIN perform 1; END $$; select 2;").length,3);});
