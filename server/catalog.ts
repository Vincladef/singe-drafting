import { db } from './db.ts';
import type { Champion } from './types.ts';
// This is the durable catalogue deployed with local assets, not an expiring response cache.
export async function catalogSnapshot():Promise<{version:string;champions:Champion[]}>{
  const rows=await db()`select value from drafting.cache where key='catalog'`;
  if(rows[0])return rows[0].value;
  const champions=await db()`select id,riot_key::text as key,name,tags from drafting.champions order by name`;
  return {version:'',champions:champions as Champion[]};
}
