import assert from 'node:assert/strict';
import api from '../netlify/functions/api.mts';
import { status } from '../server/db.ts';
export async function verifyBackend(){
 const origin='https://singe-drafting.netlify.app';
 const draft={blue:['Darius','Fiddlesticks','Ahri',null,null],red:['Garen','Viego','Yasuo','Caitlyn','Nautilus'],selected:{blue:[3,4],red:[]},bans:[],filter:{patch:'all',platform:'all',queue:420,days:30,tier:'all'}};
 const response=await api(new Request(origin+'/api/analyze',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(draft)}),{ip:'build-verification'} as any);
 assert.equal(response.status,200);const result=await response.json();assert.equal(result.context.source,'OP.GG MCP');assert.equal(result.context.games,null);assert.equal(result.probability,null);assert.equal(result.context.regionVerified,false);
 assert.ok(result.cards.blue[2].role.n>1000,'Ahri MID must use a substantial provider aggregate');
 assert.equal(result.collective.blue.allies.wr,null,'No invented full composition rate');
 assert.equal(result.recommendations.blue.length,3,'Three real aggregate-backed ADC + support options required');
 for(const path of ['profile','accounts','drafts'])assert.equal((await api(new Request(origin+'/api/'+path),{} as any)).status,401);
 const live=await api(new Request(origin+'/api/live',{method:'POST',headers:{origin},body:'{}'}),{} as any);assert.equal((await live.json()).status,'unsupported');
 const identity={riotId:'Faker#KR  1',platform:'KR'};
 const publicResponse=await api(new Request(origin+'/api/players/lookup',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(identity)}),{ip:'build-verification'} as any);
 assert.equal(publicResponse.status,200,'Public OP.GG profile must work without Google');const profile=await publicResponse.json();assert.ok(profile.profile.overall.n>0);assert.equal(profile.profile.context.source,'OP.GG MCP');
 const publicDraft={...draft,publicPlayers:[{side:'blue',slot:1,...identity}]};
 const publicAnalysis=await api(new Request(origin+'/api/analyze',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(publicDraft)}),{ip:'build-verification'} as any);assert.equal(publicAnalysis.status,200);const personalized=await publicAnalysis.json();assert.equal(personalized.missingPublicProfiles.length,0);assert.equal(personalized.cards.blue[1].personal.overall.n,profile.profile.overall.n);
 await status('verification','backend_passed',{source:'OP.GG MCP',ahriMidSample:result.cards.blue[2].role.n,coveredChampions:result.context.coveredChampions,anonymousProtected:true,riotApiEnabled:false});
 console.log(`OP.GG backend verified: ${result.context.coveredChampions} champions, Ahri MID n=${result.cards.blue[2].role.n}.`);
}
