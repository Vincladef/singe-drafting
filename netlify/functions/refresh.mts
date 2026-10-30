import type { Config } from '@netlify/functions';
import { collect } from '../../server/ingest.ts';
import { db } from '../../server/db.ts';
export default async()=>{
  await collect(1);
  await db()`delete from drafting.cache where expires_at<now()`;
  await db()`delete from drafting.usage where expires_at<now()`;
  return new Response('ok');
};
export const config:Config={schedule:'*/5 * * * *'};
