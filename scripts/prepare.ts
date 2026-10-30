import { mkdir,readFile,writeFile,stat } from 'node:fs/promises';
import { neon } from '@neondatabase/serverless';
import { cache,status,env } from '../server/db.ts';
import { providerCatalog,refreshProvider,snapshot } from '../server/opgg-store.ts';
import type { Champion } from '../server/types.ts';
import sharp from 'sharp';

export function statements(sql:string){
  const out:string[]=[];let start=0,quote=false,dollar=false;
  for(let i=0;i<sql.length;i++){
    if(sql.slice(i,i+2)==='$$'&&!quote){dollar=!dollar;i++;continue;}
    if(sql[i]==="'"&&!dollar){if(quote&&sql[i+1]==="'"){i++;continue;}quote=!quote;}
    if(sql[i]===';'&&!quote&&!dollar){const part=sql.slice(start,i).trim();if(part)out.push(part);start=i+1;}
  }
  return out;
}
async function download(url:string,path:string){
  try{if((await stat(path)).size>100)return;}catch{}
  const res=await fetch(url,{signal:AbortSignal.timeout(30000),headers:{'User-Agent':'SingeDrafting/1.0 (https://singe-drafting.netlify.app; licensed project assets)'}});
  if(!res.ok)throw new Error(`Asset unavailable (${res.status}): ${new URL(url).hostname}`);
  await writeFile(path,new Uint8Array(await res.arrayBuffer()));
}
async function prepare(){
  await writeFile('server/build-info.ts',`export const buildInfo=${JSON.stringify({commit:env('COMMIT_REF')||'development',builtAt:new Date().toISOString()})};\n`);
  await mkdir('public/assets/champions',{recursive:true});await mkdir('public/data',{recursive:true});
  // Original CC BY 2.0 photo, bundled in the deploy. The page never hotlinks it.
  await download('https://upload.wikimedia.org/wikipedia/commons/1/1d/Chimpanzee_Portrait.jpg','public/assets/monkey.jpg');
  await sharp('public/assets/monkey.jpg').resize({width:1600,withoutEnlargement:true}).webp({quality:82}).toFile('public/assets/monkey.webp');
  const versions=await (await fetch('https://ddragon.leagueoflegends.com/api/versions.json')).json();
  const version=versions[0];const payload=await (await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`)).json();
  if(!env('DATABASE_URL')){throw new Error('DATABASE_URL is required for OP.GG snapshots.');}
  const sql=neon(env('DATABASE_URL'));
  await sql.transaction(statements(await readFile('migrations/001_initial.sql','utf8')).map(s=>sql.query(s)));
  await sql.transaction(statements(await readFile('migrations/002_timeline_sampling.sql','utf8')).map(s=>sql.query(s)));
  await sql.transaction(statements(await readFile('migrations/003_collection.sql','utf8')).map(s=>sql.query(s)));
  await sql.transaction(statements(await readFile('migrations/004_opgg.sql','utf8')).map(s=>sql.query(s)));
  const official:Champion[]=Object.values(payload.data).map((c:any)=>({id:c.id,key:c.key,name:c.name,tags:c.tags}));
  const provider=await providerCatalog();
  const champions:Champion[]=provider.map(c=>({...c,name:official.find(x=>x.id===c.id)?.name||c.name,tags:official.find(x=>x.id===c.id)?.tags||[]}));
  for(let i=0;i<champions.length;i+=12)await Promise.all(champions.slice(i,i+12).map(c=>download(`https://ddragon.leagueoflegends.com/cdn/${version}/img/champion/${c.id}.png`,`public/assets/champions/${c.id}.png`)));
  await writeFile('public/data/catalog.json',JSON.stringify({version,champions}));
  console.log(`Assets: licensed photo and ${champions.length} official champion portraits (${version}).`);
  await cache('catalog',{version,champions},30*86400,'OP.GG MCP catalogue + Data Dragon translated names and portraits');
  console.log('Database migrations applied.');
  await sql.transaction(champions.map(c=>sql`insert into drafting.champions(id,riot_key,name,tags) values(${c.id},${Number(c.key)},${c.name},${JSON.stringify(c.tags||[])}::jsonb) on conflict(id) do update set name=excluded.name,tags=excluded.tags,updated_at=now()`));
  const ingestion={ranked:await refreshProvider('ranked'),flex:await refreshProvider('flex')};
  const data=await snapshot('ranked');
  if(data.completed.length<50)throw new Error('OPGG_INSUFFICIENT_INITIAL_COVERAGE');
  await writeFile('public/data/build-status.json',JSON.stringify({builtAt:new Date().toISOString(),assets:true,database:true,source:'OP.GG MCP',ingestion}));
  if(env('OPENAI_API_KEY')){
    try{
      const res=await fetch('https://api.openai.com/v1/models/gpt-6-luna',{headers:{authorization:`Bearer ${env('OPENAI_API_KEY')}`},signal:AbortSignal.timeout(10000)});
      await status('openai',res.ok?'model_available':`http_${res.status}`,{model:'gpt-6-luna',generationTested:false});
      console.log(`OpenAI Luna availability: HTTP ${res.status}.`);
    }catch{await status('openai','unreachable',{model:'gpt-6-luna'});}
  }
  console.log('Bootstrap complete. No credentials are included in published assets.');
  const {verifyBackend}=await import('./verify-backend.ts');await verifyBackend();
}
if(process.argv[1]?.endsWith('prepare.ts'))await prepare();
