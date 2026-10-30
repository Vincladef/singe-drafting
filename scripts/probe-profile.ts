import { withOpgg } from '../server/opgg-client.ts';
import { mkdir,writeFile } from 'node:fs/promises';
const out:any={};
await withOpgg(async call=>{for(const [game_name,tag_line,region]of [['Fak','','KR'],['Faker','','KR'],['Agur','','EUW'],['Hide on b','','KR']]){
 try{const data=await call('lol_get_summoner_profile',{game_name,tag_line,region,lang:'en_US',desired_output_fields:['data.summoner.{game_name,tagline,region}']});out[region+':'+game_name]=data;}catch(e){out[region+':'+game_name]={error:String(e)};}
}});
const config=await(await fetch('https://singe-drafting.netlify.app/api/config')).json(),base=config.authUrl.replace(/\/$/,'');
out.auth={base,issuer:new URL(base).origin,probes:[]};
for(const path of ['/jwt','/jwks','/.well-known/jwks.json']){const r=await fetch(base+path);const data=await r.json().catch(()=>({}));out.auth.probes.push({path,status:r.status,keys:Array.isArray(data.keys)?data.keys.map((k:any)=>({kty:k.kty,alg:k.alg,crv:k.crv,kid:k.kid})):null});}
await mkdir('provider-probe',{recursive:true});await writeFile('provider-probe/profile.json',JSON.stringify(out,null,2));
