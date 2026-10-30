import test from 'node:test';
import assert from 'node:assert/strict';
import { signWork,verifyWork } from '../server/worker.ts';
test('Collector rejects forged and expired dispatches',()=>{
  const old=process.env.DATABASE_URL;process.env.DATABASE_URL='test-only-key';
  try{const now=Date.now(),body=JSON.stringify({issuedAt:now,nonce:'test'}),signature=signWork(body);
    assert.equal(verifyWork(body,signature,now),true);assert.equal(verifyWork(body,'00',now),false);assert.equal(verifyWork(body,signature,now+180000),false);assert.equal(verifyWork(body+' ',signature,now),false);
  }finally{if(old===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=old;}
});
