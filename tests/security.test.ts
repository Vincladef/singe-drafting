import test from 'node:test';
import assert from 'node:assert/strict';
import { sameOrigin,userId,jsonBody,HttpError } from '../server/auth.ts';
import api from '../netlify/functions/api.mts';
test('Private endpoints reject anonymous and invalid sessions before DB access',async()=>{
  for(const path of ['profile','accounts','drafts','ask']){
    const response=await api(new Request(`https://singe-drafting.netlify.app/api/${path}`,{method:path==='ask'?'POST':'GET'}),{} as any);assert.equal(response.status,401);
  }
  await assert.rejects(userId(new Request('https://example.com',{headers:{authorization:'Bearer fake'}})),(e:any)=>e.status===401);
});
test('Cross-origin mutations are blocked',()=>{assert.throws(()=>sameOrigin(new Request('https://singe-drafting.netlify.app/api/drafts',{headers:{origin:'https://evil.test'}})),HttpError);});
test('Oversized bodies and malformed JSON rejected',async()=>{
  await assert.rejects(jsonBody(new Request('https://example.com',{method:'POST',body:'x'.repeat(40000)})),(e:any)=>e.status===413);
  await assert.rejects(jsonBody(new Request('https://example.com',{method:'POST',body:'{'})),(e:any)=>e.status===400);
});
