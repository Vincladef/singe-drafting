import { db } from './db.ts';
import { HttpError } from './auth.ts';
import { withOpgg } from './opgg-client.ts';
import { publishedStat,championId } from './opgg-data.ts';
import type { Champion,Stat } from './types.ts';
export const PLATFORMS:Record<string,string>={EUW1:'EUW',EUN1:'EUNE',NA1:'NA',KR:'KR',BR1:'BR',JP1:'JP',TR1:'TR',RU:'RU',LA1:'LAN',LA2:'LAS',OC1:'OCE',SG2:'SG',TW2:'TW',VN2:'VN',ME1:'ME'};
export interface PlayerProfile{overall:Stat;champions:{champion:string;stat:Stat}[];rank:any[];recent:never[];context:{source:'OP.GG MCP';gameType:string|null;season:number|null;updatedAt:string|null;fetchedAt:string;roleAvailable:false;matchupsAvailable:false};}
export function parseRiotId(id:string){const i=id.lastIndexOf('#');if(i<1||i===id.length-1)throw new HttpError(400,'Indique le Riot ID complet : Pseudo#TAG.');return {game_name:id.slice(0,i).trim(),tag_line:id.slice(i+1).trim()};}
export function normalizeProfile(payload:any,requested:{game_name:string;tag_line:string},catalog:Champion[]):PlayerProfile{
 const s=payload.data?.summoner;if(!s)throw new HttpError(404,'Profil OP.GG introuvable.');
 // The provider may return a fuzzy search result: do not silently associate a different account.
 if(String(s.game_name).trim().toLowerCase()!==requested.game_name.toLowerCase()||String(s.tagline).trim().toLowerCase()!==requested.tag_line.toLowerCase())throw new HttpError(404,'OP.GG n’a pas renvoyé exactement ce Riot ID. Vérifie le pseudo, le tag et la région.');
 const most=s.most_champions;
 const champions=(most?.champion_stats||[]).flatMap((r:any)=>{const id=championId(catalog,r.champion_name,r.id);if(!id)return [];const stat=publishedStat(r);if(typeof r.kill==='number'&&typeof r.assist==='number'&&typeof r.death==='number')stat.kda=(r.kill+r.assist)/Math.max(1,r.death);if(r.game_length_second>0){stat.cs=60*((r.minion_kill||0)+(r.neutral_minion_kill||0))/r.game_length_second;stat.dpm=60*r.damage_dealt_to_champions/r.game_length_second;}return [{champion:id,stat}];});
 return {overall:publishedStat(most),champions,rank:(s.league_stats||[]).filter((x:any)=>x.tier_info?.tier).map((x:any)=>({queueType:x.game_type,tier:x.tier_info.tier,rank:x.tier_info.division,leaguePoints:x.tier_info.lp,win:x.win,lose:x.lose})),recent:[],context:{source:'OP.GG MCP',gameType:most?.game_type||null,season:most?.season_id??null,updatedAt:s.updated_at||null,fetchedAt:new Date().toISOString(),roleAvailable:false,matchupsAvailable:false}};
}
export async function playerProfile(account:any,catalog:Champion[],force=false):Promise<PlayerProfile>{
 if(!force&&account.summary&&Date.now()-Date.parse(account.refreshed_at)<900000)return account.summary;
 if(account.id){const lease=await db()`update drafting.player_accounts set last_attempt_at=now() where id=${account.id} and user_id=${account.user_id} and (last_attempt_at is null or last_attempt_at<now()-interval '15 minutes') returning id`;if(!lease.length){if(account.summary)return account.summary;throw new HttpError(503,'Actualisation OP.GG en attente. Réessaie dans 15 minutes.');}}
 try{const profile=await withOpgg(async call=>normalizeProfile(await call('lol_get_summoner_profile',{game_name:account.game_name,tag_line:account.tag_line,region:PLATFORMS[account.platform],lang:'en_US',desired_output_fields:['data.summoner.{game_name,tagline,region,updated_at}','data.summoner.league_stats[].{game_type,win,lose}','data.summoner.league_stats[].tier_info.{tier,division,lp}','data.summoner.most_champions.{game_type,play,win,lose,season_id}','data.summoner.most_champions.champion_stats[].{id,champion_name,play,win,lose,kill,death,assist,game_length_second,minion_kill,neutral_minion_kill,damage_dealt_to_champions}']}),account,catalog));
 if(account.id)await db()`update drafting.player_accounts set summary=${JSON.stringify(profile)}::jsonb,rank_data=${JSON.stringify(profile.rank)}::jsonb,refreshed_at=now() where id=${account.id} and user_id=${account.user_id}`;
 return profile;
 }catch(e){if(account.summary&&!force)return account.summary;throw e;}
}
