import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { env } from './db.ts';
import { refreshProvider } from './opgg-store.ts';
export function signWork(body:string){return createHmac('sha256',env('DATABASE_URL')).update(body).digest('hex');}
export function verifyWork(body:string,signature:string,now=Date.now()){
 try{const data=JSON.parse(body);if(!env('DATABASE_URL')||!Number.isFinite(data.issuedAt)||Math.abs(now-data.issuedAt)>120000)return false;const a=Buffer.from(signWork(body),'hex'),b=Buffer.from(signature,'hex');return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}
}
export async function runCollector(){const ranked=await refreshProvider('ranked',360000),flex=await refreshProvider('flex',360000);return {ranked,flex};}
