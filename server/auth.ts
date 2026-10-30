import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from './db.ts';
let jwks:ReturnType<typeof createRemoteJWKSet>|undefined;
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export async function userId(req:Request,required=true):Promise<string|null>{
  const header=req.headers.get('authorization');
  if(!header){if(required)throw new HttpError(401,'Connecte-toi avec Google pour accéder à tes données.');return null;}
  try{
    const base=env('NEON_AUTH_BASE_URL').replace(/\/$/,'');if(!base)throw new Error('AUTH_UNAVAILABLE');
    jwks??=createRemoteJWKSet(new URL(`${base}/.well-known/jwks.json`));
    const {payload}=await jwtVerify(header.replace(/^Bearer /,''),jwks,{issuer:base,algorithms:['EdDSA'],clockTolerance:5});
    if(!payload.sub||!payload.exp)throw new Error('INVALID_SESSION');return payload.sub;
  }catch{throw new HttpError(401,'Session expirée ou invalide. Reconnecte-toi avec Google.');}
}
export async function jsonBody(req:Request){
  if(Number(req.headers.get('content-length')||0)>32768)throw new HttpError(413,'Requête trop volumineuse.');
  const raw=await req.text();if(raw.length>32768)throw new HttpError(413,'Requête trop volumineuse.');
  try{return JSON.parse(raw);}catch{throw new HttpError(400,'Requête JSON invalide.');}
}
export function sameOrigin(req:Request){
  const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)throw new HttpError(403,'Origine non autorisée.');
}
