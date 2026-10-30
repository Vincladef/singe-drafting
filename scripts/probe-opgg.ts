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
  console.log(JSON.stringify({server:client.getServerVersion(),tools:tools.map(t=>t.name)}));
}finally{await client.close();}
