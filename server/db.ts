import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
export const env=(key:string)=>process.env[key]||'';
export function db(){const url=env('DATABASE_URL');if(!url)throw new Error('DATABASE_UNAVAILABLE');return neon(url);}
export const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function cached<T>(key:string):Promise<T|null>{
  const rows=await db()`select value from drafting.cache where key=${key} and expires_at>now()`;
  return rows[0]?.value??null;
}
export async function cache(key:string,value:unknown,seconds:number,source:string){
  await db()`insert into drafting.cache(key,value,expires_at,source) values(${key},${JSON.stringify(value)}::jsonb,now()+${seconds}*interval '1 second',${source}) on conflict(key) do update set value=excluded.value,expires_at=excluded.expires_at,source=excluded.source,updated_at=now()`;
}
export async function quota(subject:string,limit:number,seconds=3600){
  const bucket=Math.floor(Date.now()/1000/seconds);
  const rows=await db()`insert into drafting.usage(subject,bucket,count) values(${subject},${bucket},1) on conflict(subject,bucket) do update set count=drafting.usage.count+1 where drafting.usage.count<${limit} returning count`;
  return rows.length>0;
}
export async function status(provider:string,state:string,details:unknown={}){
  await db()`insert into drafting.provider_status(provider,status,details) values(${provider},${state},${JSON.stringify(details)}::jsonb) on conflict(provider) do update set status=excluded.status,details=excluded.details,checked_at=now()`;
}
