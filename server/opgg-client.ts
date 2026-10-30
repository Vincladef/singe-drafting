import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { parseOpggResult } from './opgg-format.ts';
export const OPGG_ENDPOINT='https://mcp-api.op.gg/mcp';
const ALLOWED=new Set(['lol_list_champions','lol_list_lane_meta_champions','lol_get_champion_analysis','lol_get_champion_synergies','lol_get_lane_matchup_guide','lol_get_summoner_profile','lol_list_summoner_matches']);
export class OpggError extends Error{constructor(public code:string){super(code);}}
export async function withOpgg<T>(fn:(call:(name:string,args:Record<string,unknown>)=>Promise<any>)=>Promise<T>):Promise<T>{
  const client=new Client({name:'singe-drafting',version:'2.0.0'},{capabilities:{}});
  try{
    await client.connect(new StreamableHTTPClientTransport(new URL(OPGG_ENDPOINT)),{timeout:15000});
    return await fn(async(name,args)=>{
      if(!ALLOWED.has(name))throw new OpggError('UNSUPPORTED_TOOL');
      const result=await client.callTool({name,arguments:args},undefined,{timeout:20000});
      return parseOpggResult(result);
    });
  }catch(e){if(e instanceof OpggError)throw e;throw new OpggError(e instanceof Error&&e.message.startsWith('OPGG_')?e.message:'OPGG_UNAVAILABLE');}
  finally{await client.close().catch(()=>{});}
}
