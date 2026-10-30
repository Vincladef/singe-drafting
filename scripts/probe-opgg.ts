import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { mkdir,writeFile } from 'node:fs/promises';
const client=new Client({name:'singe-drafting-provider-verification',version:'1.0.0'},{capabilities:{}});
try{
  await client.connect(new StreamableHTTPClientTransport(new URL('https://mcp-api.op.gg/mcp')));
  const tools=[];let cursor:string|undefined;
  do{const page=await client.listTools(cursor?{cursor}:undefined);tools.push(...page.tools);cursor=page.nextCursor;}while(cursor);
  await mkdir('provider-probe',{recursive:true});
  await writeFile('provider-probe/contract.json',JSON.stringify({server:client.getServerVersion(),tools},null,2));
  try{await writeFile('provider-probe/resources.json',JSON.stringify({resources:await client.listResources(),templates:await client.listResourceTemplates()},null,2));}catch{}
  const calls=[
    {name:'lol_list_champions',arguments:{lang:'en_US',desired_output_fields:['data.champions[].{champion_id,key,name,release_date}']}},
    {name:'lol_list_lane_meta_champions',arguments:{lang:'en_US',position:'all',desired_output_fields:['data.positions.top[].{champion,play,win,win_rate,pick_rate,ban_rate,kda,role_rate}','data.positions.jungle[].{champion,play,win,win_rate,pick_rate,ban_rate,kda,role_rate}','data.positions.mid[].{champion,play,win,win_rate,pick_rate,ban_rate,kda,role_rate}','data.positions.adc[].{champion,play,win,win_rate,pick_rate,ban_rate,kda,role_rate}','data.positions.support[].{champion,play,win,win_rate,pick_rate,ban_rate,kda,role_rate}']}},
    {name:'lol_get_champion_analysis',arguments:{game_mode:'ranked',champion:'AHRI',position:'mid',lang:'en_US',desired_output_fields:['champion','position','data.summary.average_stats.{ban_rate,kda,pick_rate,play,win_rate}','data.summary.positions[].name','data.summary.positions[].stats.{ban_rate,kda,pick_rate,play,role_rate,win_rate}','data.summary.positions[].counters[].{champion_id,champion_name,play,win}','data.strong_counters[].{champion_id,champion_name,my_win_rate,counter_win_rate,play,win,win_rate}','data.weak_counters[].{champion_id,champion_name,my_win_rate,counter_win_rate,play,win,win_rate}','data.synergies.jungle[].{champion_id,champion_name,play,position,synergy_champion_id,synergy_champion_name,synergy_position,win,win_rate}','data.trends.win.{created_at,rate,version}']}},
    {name:'lol_get_champion_synergies',arguments:{champion:'JINX',my_position:'adc',synergy_position:'support',lang:'en_US',desired_output_fields:['data.synergies[].{champion_id,champion_name,play,position,synergy_champion_id,synergy_champion_name,synergy_position,win,win_rate}']}},
    {name:'lol_get_lane_matchup_guide',arguments:{my_champion:'AHRI',opponent_champion:'AKALI',position:'mid',lang:'en_US'}},
    {name:'lol_get_summoner_profile',arguments:{game_name:'Faker',tag_line:'KR1',region:'KR',lang:'en_US',desired_output_fields:['data.summoner.{game_name,tagline,region,updated_at}','data.summoner.league_stats[].{game_type,win,lose,updated_at}','data.summoner.league_stats[].tier_info.{tier,division,lp}','data.summoner.most_champions.{game_type,play,win,lose,season_id,year}','data.summoner.most_champions.champion_stats[].{id,champion_name,play,win,lose,kill,death,assist,game_length_second,minion_kill,neutral_minion_kill,damage_dealt_to_champions}','data.summoner.ranked_most_champions.{game_type,play,win,lose,season_id}','data.summoner.ranked_most_champions.my_champion_stats[].{id,champion_name,play,win,lose,game_second}','data.summoner.ranked_most_champions.my_champion_stats[].basic.{kill,death,assist,cs,damage_to_champion,vision_score,kill_participation}']}}
  ];
  for(const request of calls){
    try{const result=await client.callTool(request,undefined,{timeout:45000});await writeFile(`provider-probe/${request.name}.json`,JSON.stringify(result,null,2));console.log(request.name,'ok');}
    catch(e){await writeFile(`provider-probe/${request.name}.json`,JSON.stringify({error:String(e)}));console.log(request.name,'unavailable');}
  }
  console.log(JSON.stringify({server:client.getServerVersion(),tools:tools.map(t=>t.name)}));
}finally{await client.close();}
