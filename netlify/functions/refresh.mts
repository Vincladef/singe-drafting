import type { Config,Context } from '@netlify/functions';
import { randomUUID } from 'node:crypto';
import { signWork } from '../../server/worker.ts';
import { db } from '../../server/db.ts';
export default async(_req:Request,context:Context)=>{
  const body=JSON.stringify({issuedAt:Date.now(),nonce:randomUUID()});
  const result=await fetch(new URL('/.netlify/functions/collect-background',context.site.url),{method:'POST',headers:{'content-type':'application/json','x-singe-signature':signWork(body)},body,signal:AbortSignal.timeout(10000)});
  if(!result.ok)throw new Error(`COLLECTOR_DISPATCH_${result.status}`);
  await db()`delete from drafting.cache where expires_at<now() and key<>'catalog'`;
  await db()`delete from drafting.usage where expires_at<now()`;
  return new Response('ok');
};
export const config:Config={schedule:'* * * * *'};
