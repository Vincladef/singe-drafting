import { db,cached } from './db.ts';
import { Engine } from './engine.ts';
import type { Draft } from './types.ts';
import { HttpError } from './auth.ts';
import { catalogSnapshot } from './catalog.ts';
import { snapshot } from './opgg-store.ts';
import { playerProfile,publicProfileKey,type PublicProfile,type PlayerProfile } from './opgg-player.ts';
export const catalog=catalogSnapshot;
export async function analyze(draft:Draft,user:string|null){
 const cat=await catalog(),ids=new Set(cat.champions.map(c=>c.id));
 if([...draft.blue,...draft.red,...draft.bans].some(c=>c&&!ids.has(c)))throw new HttpError(400,'Champion inconnu dans le catalogue.');
 if(draft.filter.platform!=='all'||draft.filter.tier!=='all'||draft.filter.patch!=='all')throw new HttpError(400,'OP.GG MCP : All Tiers uniquement ; région, patch et période ne sont pas sélectionnables.');
 const players:{blue:Record<number,string>;red:Record<number,string>}={blue:{},red:{}},profiles:Record<string,PlayerProfile>={};
 if(draft.players?.length){if(!user)throw new HttpError(401,'Connexion requise pour les statistiques personnelles.');
 const rows=await db()`select * from drafting.player_accounts where user_id=${user}`;
 for(const p of draft.players){const a=rows.find(r=>r.id===p.accountId);if(!a)throw new HttpError(403,'Compte indisponible.');players[p.side][p.slot]=a.id;if(!profiles[a.id])try{profiles[a.id]=await playerProfile(a,cat.champions);}catch{/* General statistics stay available; missing personal data remain null. */}}
 }
 const missingPublicProfiles:{side:string;slot:number}[]=[];
 for(const p of draft.publicPlayers||[]){const key=publicProfileKey(p),hit=await cached<PublicProfile>(key);if(hit){players[p.side][p.slot]=key;profiles[key]=hit.profile;}else missingPublicProfiles.push({side:p.side,slot:p.slot});}
 const data=await snapshot(draft.filter.queue===440?'flex':'ranked');
 const engine=new Engine(data,profiles);return {result:{...engine.analyze(draft,players),missingPublicProfiles},engine};
}
