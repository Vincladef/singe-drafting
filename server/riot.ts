import { cached, cache, db, env, hash, quota, status } from './db.ts';
import { AsyncLocalStorage } from 'node:async_hooks';
const backgroundBudget=new AsyncLocalStorage<boolean>();
export const withBackgroundBudget=<T>(fn:()=>Promise<T>)=>backgroundBudget.run(true,fn);
export const PLATFORMS:Record<string,string>={EUW1:'europe',EUN1:'europe',TR1:'europe',RU:'europe',NA1:'americas',BR1:'americas',LA1:'americas',LA2:'americas',KR:'asia',JP1:'asia',OC1:'sea',PH2:'sea',SG2:'sea',TH2:'sea',TW2:'sea',VN2:'sea'};
export class RiotError extends Error {constructor(public status:number,public retryAfter=0){super(`RIOT_${status}`);}}
export async function riot<T=any>(host:string,path:string,ttl=300):Promise<T>{
  if(!Object.values(PLATFORMS).includes(host)&&!Object.keys(PLATFORMS).map(x=>x.toLowerCase()).includes(host))throw new Error('INVALID_ROUTING');
  const key=`riot:${hash(host+path)}`;const hit=await cached<T>(key);if(hit)return hit;
  if(!env('RIOT_API_KEY'))throw new RiotError(503);
  if(backgroundBudget.getStore()&&(!await quota('riot:background:daily',20000,86400)||!await quota('riot:background:2min',60,120)))throw new RiotError(429,30);
  const block=await cached<boolean>('riot:backoff');if(block)throw new RiotError(429,120);
  // All functions share these conservative budgets, including background jobs.
  if(!await quota('riot:global:2min',80,120)||!await quota('riot:global:second',8,1))throw new RiotError(429,2);
  const res=await fetch(`https://${host}.api.riotgames.com${path}`,{headers:{'X-Riot-Token':env('RIOT_API_KEY')},signal:AbortSignal.timeout(12000)});
  if(!res.ok){
    const retry=Math.min(3600,Math.max(1,Number(res.headers.get('retry-after'))||120));
    if(res.status===429)await cache('riot:backoff',true,retry,'Riot Retry-After');
    await status('riot',`http_${res.status}`,{retryAfter:res.status===429?retry:undefined,publicationApproval:'not_verifiable_from_api'});
    throw new RiotError(res.status,res.status===429?retry:0);
  }
  const data=await res.json() as T;if(ttl>0)await cache(key,data,ttl,'Riot API');
  await status('riot','reachable',{publicationApproval:'not_verifiable_from_api',applicationRateLimits:res.headers.get('x-app-rate-limit'),methodRateLimits:res.headers.get('x-method-rate-limit')});return data;
}
export function routing(platform:string){const route=PLATFORMS[platform];if(!route)throw new Error('INVALID_PLATFORM');return route;}
export async function identify(riotId:string,platform:string){
  const index=riotId.lastIndexOf('#');if(index<1||index===riotId.length-1)throw new Error('INVALID_RIOT_ID');
  return riot<{puuid:string;gameName:string;tagLine:string}>(routing(platform)==='sea'?'asia':routing(platform),`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(riotId.slice(0,index))}/${encodeURIComponent(riotId.slice(index+1))}`,3600);
}
export async function enqueue(puuid:string,platform:string,accountId?:string){
  const key=hash(puuid+platform);
  await db()`insert into drafting.jobs(key,kind,payload) values(${key},'player',${JSON.stringify({puuid,platform,accountId})}::jsonb) on conflict(key) do update set status='pending',cursor=0,available_at=now(),updated_at=now() where drafting.jobs.updated_at<now()-interval '15 minutes'`;
}
