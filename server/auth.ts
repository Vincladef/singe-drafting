import { createRemoteJWKSet, jwtVerify,type JWTVerifyGetKey } from 'jose';
import { env } from './db.ts';
let jwks:ReturnType<typeof createRemoteJWKSet>|undefined;
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export async function verifySessionToken(token:string,keys:JWTVerifyGetKey,base:string){
  // Managed Neon tokens and Better Auth tokens use the origin or configured Auth URL.
  // Both are pinned to this branch's configured URL and verified with its own Ed25519 key.
  const {payload}=await jwtVerify(token,keys,{issuer:[new URL(base).origin,base.replace(/\/$/,'')],algorithms:['EdDSA'],clockTolerance:5});
  if(!payload.sub||!payload.exp||payload.role==='anonymous'||payload.is_anonymous===true)throw new Error('INVALID_SESSION');
  return payload.sub;
}
export async function userId(req:Request,required=true):Promise<string|null>{
  const header=req.headers.get('authorization');
  if(!header){if(required)throw new HttpError(401,'Connecte-toi avec Google pour accéder à tes données.');return null;}
  try{
    if(!/^Bearer\s+\S+$/i.test(header)||header.replace(/^Bearer\s+/i,'').split('.').length!==3)throw new Error('INVALID_SESSION');
    const base=env('NEON_AUTH_BASE_URL').replace(/\/$/,'');if(!base)throw new Error('AUTH_UNAVAILABLE');
    jwks??=createRemoteJWKSet(new URL(env('NEON_AUTH_JWKS_URL')||`${base}/.well-known/jwks.json`));
    return await verifySessionToken(header.replace(/^Bearer\s+/i,''),jwks,base);
  }catch(e){
    if(e instanceof Error&&(/fetch|Expected 200|AUTH_UNAVAILABLE/i.test(e.message)||(e as any).code==='ERR_JWKS_TIMEOUT'))throw new HttpError(503,'La vérification Neon est momentanément indisponible. Réessaie dans un instant.');
    throw new HttpError(401,'Session expirée ou invalide. Reconnecte-toi avec Google.');
  }
}
export async function jsonBody(req:Request){
  if(Number(req.headers.get('content-length')||0)>32768)throw new HttpError(413,'Requête trop volumineuse.');
  const raw=await req.text();if(raw.length>32768)throw new HttpError(413,'Requête trop volumineuse.');
  try{return JSON.parse(raw);}catch{throw new HttpError(400,'Requête JSON invalide.');}
}
export function sameOrigin(req:Request){
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new HttpError(403,'Origine non autorisée.');
}
