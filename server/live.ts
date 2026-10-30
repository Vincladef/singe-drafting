import type { Champion } from './types.ts';
import { riot,identify,RiotError } from './riot.ts';

export function publicGame(raw:any,catalog:Champion[],trackedPuuid?:string){
  return {gameId:String(raw.gameId),queue:raw.gameQueueConfigId,mode:raw.gameMode,mapId:raw.mapId,
    trackedTeam:trackedPuuid?(raw.participants||[]).find((p:any)=>p.puuid===trackedPuuid)?.teamId??null:null,
    startedAt:raw.gameStartTime?new Date(raw.gameStartTime).toISOString():null,
    teams:[100,200].map(team=>({team,champions:(raw.participants||[]).filter((p:any)=>p.teamId===team).map((p:any)=>({
      champion:catalog.find(c=>String(c.key)===String(p.championId))?.id||null,
      spells:[p.spell1Id,p.spell2Id].filter(Number.isFinite),role:null
    }))})),
    bans:(raw.bannedChampions||[]).map((b:any)=>catalog.find(c=>String(c.key)===String(b.championId))?.id).filter(Boolean),
    source:'Riot Spectator-V5',rolesAvailable:false};
}
export async function activeGame(riotId:string,platform:string,catalog:Champion[]){
  const account=await identify(riotId,platform);
  try{
    const raw=await riot(platform.toLowerCase(),`/lol/spectator/v5/active-games/by-summoner/${encodeURIComponent(account.puuid)}`,20);
    return {status:'in_game',account:{riotId:`${account.gameName}#${account.tagLine}`,platform},game:publicGame(raw,catalog,account.puuid)};
  }catch(e){
    if(e instanceof RiotError&&e.status===404)return {status:'not_in_game',message:'Aucune partie commencée n’est visible pour ce compte. Riot ne fournit pas ici la sélection des champions. Réessaie après le chargement de la partie, ou utilise la draft manuelle.'};
    throw e;
  }
}
