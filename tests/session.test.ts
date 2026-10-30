import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {verifySessionToken} from '../server/auth.ts';
import {sessionToken,tokenFromResponse} from '../src/session.ts';
import {publicProfileKey,profileSuggestion,parseRiotId} from '../server/opgg-player.ts';
import {draftSchema} from '../server/validation.ts';
const token=(exp=Math.floor(Date.now()/1000)+900)=>'header.'+Buffer.from(JSON.stringify({exp})).toString('base64url')+'.signature';
test('Neon cached session JWT is accepted when token() would return the cached session shape',async()=>{
 const jwt=token();assert.equal(tokenFromResponse({data:{session:{token:jwt}}}),jwt);
 assert.equal(await sessionToken({getSession:async()=>({data:{session:{token:jwt}}}),token:async()=>{throw new Error('Unnecessary network call');}}),jwt);
});
test('Opaque cookie and expired JWT never authorize a private request; refresh bypasses SDK cache',async()=>{
 let forced=false;const jwt=token();const auth={getSession:async()=>({data:{session:{token:'cookie-secret'}}}),token:async(options:any)=>{forced=options.fetchOptions.headers['X-Force-Fetch']==='true';return {data:{token:jwt}};}};
 assert.equal(await sessionToken(auth),jwt);assert.equal(forced,true);assert.equal(tokenFromResponse({data:{token:token(1)}}),null);assert.equal(tokenFromResponse({data:{token:'cookie-secret'}}),null);
});
test('Only configured Neon issuer variants are accepted; signatures, branch and expiry remain mandatory',async()=>{
 const {publicKey,privateKey}=await generateKeyPair('EdDSA'),jwk=await exportJWK(publicKey),keys=createLocalJWKSet({keys:[{...jwk,kid:'test'}]}),base='https://auth.example.test/database/auth';
 const sign=(issuer:string,exp:number,role='authenticated')=>new SignJWT({role}).setProtectedHeader({alg:'EdDSA',kid:'test'}).setSubject('test-user').setIssuer(issuer).setExpirationTime(exp).sign(privateKey);
 const valid=await sign(new URL(base).origin,Math.floor(Date.now()/1000)+900);assert.equal(await verifySessionToken(valid,keys,base),'test-user');
 assert.equal(await verifySessionToken(await sign(base,Math.floor(Date.now()/1000)+900),keys,base),'test-user');
 await assert.rejects(verifySessionToken(await sign('https://other.example.test',Math.floor(Date.now()/1000)+900),keys,base));
 await assert.rejects(verifySessionToken(await sign(new URL(base).origin+'/other-branch/auth',Math.floor(Date.now()/1000)+900),keys,base));
 await assert.rejects(verifySessionToken(await sign(new URL(base).origin,1),keys,base));
 await assert.rejects(verifySessionToken(await sign(new URL(base).origin,Math.floor(Date.now()/1000)+900,'anonymous'),keys,base));
 await assert.rejects(verifySessionToken(valid.slice(0,-5)+'wrong',keys,base));
});
test('Public profile cache normalizes exact identities without stripping significant spaces from tags',()=>{
 assert.equal(publicProfileKey({riotId:'Visible # TAG',platform:'EUW1'}),publicProfileKey({riotId:'visible#tag',platform:'EUW1'}));
 assert.notEqual(publicProfileKey({riotId:'Visible#T AG',platform:'EUW1'}),publicProfileKey({riotId:'Visible#TAG',platform:'EUW1'}));assert.throws(()=>parseRiotId('Visible#   '));
});
test('Suggestions only contain real provider results matching the typed prefix and region',()=>{
 const raw={data:{summoner:{game_name:'Visible',tagline:'TAG'}}};assert.deepEqual(profileSuggestion(raw,'Vis#T','EUW1'),{riotId:'Visible#TAG',platform:'EUW1'});assert.equal(profileSuggestion(raw,'Other#T','EUW1'),null);assert.equal(profileSuggestion(raw,'Vis','EUW1'),null);
});
test('Public identities never allow the browser to submit statistics or replace private account ownership',()=>{
 const d={blue:Array(5).fill(null),red:Array(5).fill(null),selected:{blue:[],red:[]},bans:[],filter:{patch:'all',platform:'all',queue:420,days:30,tier:'all'},publicPlayers:[{side:'blue',slot:1,riotId:'Visible#TAG',platform:'EUW1',profile:{wr:100}}]};
 const parsed=draftSchema.parse(d);assert.equal('profile' in parsed.publicPlayers![0],false);
 assert.equal(draftSchema.safeParse({...d,players:[{side:'blue',slot:1,accountId:'00000000-0000-4000-8000-000000000001'}]}).success,false);
});
