import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { db,env,status } from './db.ts';
import { collect } from './ingest.ts';
import { withBackgroundBudget } from './riot.ts';

export function signWork(body:string){return createHmac('sha256',env('DATABASE_URL')).update(body).digest('hex');}
export function verifyWork(body:string,signature:string,now=Date.now()){
  try{
    const data=JSON.parse(body);if(!Number.isFinite(data.issuedAt)||Math.abs(now-data.issuedAt)>120000)return false;
    const expected=Buffer.from(signWork(body),'hex'),actual=Buffer.from(signature,'hex');
    return expected.length===actual.length&&timingSafeEqual(expected,actual);
  }catch{return false;}
}
export async function runCollector(maxMs=45000){
  const owner=randomUUID(),sql=db();
  const lease=await sql`insert into drafting.worker_leases(name,owner,expires_at) values('riot-collector',${owner},now()+interval '90 seconds') on conflict(name) do update set owner=excluded.owner,expires_at=excluded.expires_at where drafting.worker_leases.expires_at<now() returning owner`;
  if(!lease.length)return {busy:true};
  const started=Date.now();let imported=0,repaired=0,reason:string|undefined;
  await status('collection_worker','running',{startedAt:new Date().toISOString()});
  try{
    await withBackgroundBudget(async()=>{while(Date.now()-started<maxMs){
      const result=await collect(3,true);imported+=result.imported;repaired+=result.repaired||0;
      if(result.reason){reason=result.reason;break;}
    }});
    return {imported,repaired,reason};
  }finally{
    await sql`delete from drafting.worker_leases where name='riot-collector' and owner=${owner}`;
    await status('collection_worker',reason||'ready',{imported,repaired,durationMs:Date.now()-started,lastRun:new Date().toISOString(),cadenceSeconds:60});
  }
}
