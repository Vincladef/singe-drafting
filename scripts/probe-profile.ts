import { normalizeProfile } from '../server/opgg-player.ts';
import { createRemoteJWKSet,jwtVerify } from 'jose';
import { withOpgg } from '../server/opgg-client.ts';
import { mkdir,writeFile } from 'node:fs/promises';
const out:any={};
await withOpgg(async call=>{for(const [game_name,tag_line,region]of [['Fak','','KR'],['Faker','','KR'],['Agur','','EUW'],['Hide on b','','KR']]){
 try{const data=await call('lol_get_summoner_profile',{game_name,tag_line,region,lang:'en_US',desired_output_fields:['data.summoner.{game_name,tagline,region}']});out[region+':'+game_name]=data;}catch(e){out[region+':'+game_name]={error:String(e)};}
}});
const config=await(await fetch('https://singe-drafting.netlify.app/api/config')).json(),base=config.authUrl.replace(/\/$/,'');
out.auth={base,issuer:new URL(base).origin,probes:[]};
for(const path of ['/jwt','/jwks','/.well-known/jwks.json']){const r=await fetch(base+path);const data=await r.json().catch(()=>({}));out.auth.probes.push({path,status:r.status,keys:Array.isArray(data.keys)?data.keys.map((k:any)=>({kty:k.kty,alg:k.alg,crv:k.crv,kid:k.kid})):null});}
try{const raw=await withOpgg(call=>call('lol_get_summoner_profile',{game_name:'Faker',tag_line:'KR  1',region:'KR',lang:'en_US',desired_output_fields:['data.summoner.{game_name,tagline,updated_at}','data.summoner.most_champions.{game_type,play,win,lose,season_id}','data.summoner.most_champions.champion_stats[].{id,champion_name,play,win,lose}']}));const p=normalizeProfile(raw,{game_name:'Faker',tag_line:'KR  1'},[{id:'KogMaw',key:'96',name:'KogMaw'}]);out.exactProfile={overall:p.overall,champions:p.champions,context:p.context};}catch(e){out.exactProfile={error:String(e)};}
try{const r=await fetch(base+'/token/anonymous'),data=await r.json();if(data.token){const {payload}=await jwtVerify(data.token,createRemoteJWKSet(new URL(base+'/.well-known/jwks.json')),{issuer:new URL(base).origin,algorithms:['EdDSA']});out.auth.verified={issuer:payload.iss,hasSubject:!!payload.sub,role:payload.role,isAnonymous:payload.is_anonymous};}}catch(e){out.auth.verified={error:String(e)};}
await mkdir('provider-probe',{recursive:true});await writeFile('provider-probe/profile.json',JSON.stringify(out,null,2));
