import type { Config } from '@netlify/functions';
import { verifyWork,runCollector } from '../../server/worker.ts';
export default async(req:Request)=>{
  const body=await req.text();
  if(!verifyWork(body,req.headers.get('x-singe-signature')||''))return new Response('Unauthorized',{status:403});
  await runCollector();return new Response('ok');
};
export const config:Config={background:true,rateLimit:{action:'rate_limit',aggregateBy:'ip',windowSize:60,windowLimit:5}};
