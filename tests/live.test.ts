import test from 'node:test';
import assert from 'node:assert/strict';
import { publicGame } from '../server/live.ts';
import { signWork,verifyWork } from '../server/worker.ts';
test('Spectator response exposes champions without hidden identities, observer keys or guessed roles',()=>{
  const data=publicGame({gameId:123,mapId:11,gameQueueConfigId:420,gameMode:'CLASSIC',observers:{encryptionKey:'secret'},participants:[{teamId:100,championId:1,puuid:'hidden-player',riotId:'hidden#name',spell1Id:4,spell2Id:11},{teamId:200,championId:2,puuid:'declared-account'}]},[{id:'Annie',key:'1',name:'Annie'},{id:'Olaf',key:'2',name:'Olaf'}],'declared-account');
  assert.equal(data.teams[0].champions[0].champion,'Annie');assert.equal(data.teams[0].champions[0].role,null);assert.equal(data.trackedTeam,200);
  assert.ok(!JSON.stringify(data).includes('hidden'));assert.ok(!JSON.stringify(data).includes('secret'));
});
test('Collector rejects forged and expired dispatches',()=>{
  const old=process.env.DATABASE_URL;process.env.DATABASE_URL='test-only-key';
  try{const now=Date.now(),body=JSON.stringify({issuedAt:now,nonce:'test'}),signature=signWork(body);
    assert.equal(verifyWork(body,signature,now),true);assert.equal(verifyWork(body,'00',now),false);assert.equal(verifyWork(body,signature,now+180000),false);assert.equal(verifyWork(body+' ',signature,now),false);
  }finally{if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;}
});
