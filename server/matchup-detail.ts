import { cached,cache } from './db.ts';
import { withOpgg } from './opgg-client.ts';
import { championCode,championId,lane,publishedStat } from './opgg-data.ts';
import type {Champion,Role} from './types.ts';
export async function supplementaryMatchup(c:Champion,e:Champion,r:Role,catalog:Champion[]){
 const key=`opgg:guide:${r}:${c.id}:${e.id}`,hit=await cached<any>(key);
 const guide=hit||await withOpgg(call=>call('lol_get_lane_matchup_guide',{my_champion:championCode(c),opponent_champion:championCode(e),position:lane(r),lang:'en_US'}));
 const rows=guide.data?.counters||[];
 const selected=rows.find((row:any)=>championId(catalog,row.champion_name,row.champion_id)===e.id);
 // This tool exposes no tier or queue filter. Keep it entirely outside the All Tiers engine.
 const result={source:'OP.GG MCP · lol_get_lane_matchup_guide',population:'Population par défaut OP.GG, rang et file non précisés',compatibleWithAllTiers:false,usedInRanking:false,champion:c.id,opponent:e.id,role:r,stat:selected?publishedStat(selected):publishedStat({}),fetchedAt:hit?.fetchedAt||new Date().toISOString()};
 if(!hit)await cache(key,{data:{counters:rows},fetchedAt:result.fetchedAt},21600,'OP.GG guide · population non vérifiée');
 return result;
}
