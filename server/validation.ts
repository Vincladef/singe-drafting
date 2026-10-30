import { z } from 'zod';
import { PLATFORMS } from './riot.ts';
const champion=z.string().regex(/^[A-Za-z0-9]+$/).max(40);
export const filterSchema=z.object({patch:z.string().regex(/^(all|\d{1,2}\.\d{1,2})$/),platform:z.enum(['all',...Object.keys(PLATFORMS)] as [string,...string[]]),queue:z.union([z.literal(420),z.literal(440)]),days:z.union([z.literal(7),z.literal(14),z.literal(30),z.literal(90)]),tier:z.enum(['all','IRON','BRONZE','SILVER','GOLD','PLATINUM','EMERALD','DIAMOND','MASTER','GRANDMASTER','CHALLENGER'])});
export const draftSchema=z.object({blue:z.array(champion.nullable()).length(5),red:z.array(champion.nullable()).length(5),
  selected:z.object({blue:z.array(z.number().int().min(0).max(4)).max(5),red:z.array(z.number().int().min(0).max(4)).max(5)}),
  bans:z.array(champion).max(10),players:z.array(z.object({side:z.enum(['blue','red']),slot:z.number().int().min(0).max(4),accountId:z.uuid()})).max(10).optional(),filter:filterSchema
}).superRefine((d,ctx)=>{
  const all=[...d.blue,...d.red,...d.bans].filter(Boolean);if(new Set(all).size!==all.length)ctx.addIssue({code:'custom',message:'Champion sélectionné ou banni plusieurs fois.'});
  for(const side of ['blue','red'] as const){if(new Set(d.selected[side]).size!==d.selected[side].length||d.selected[side].some(i=>d[side][i]))ctx.addIssue({code:'custom',message:'Seuls les postes libres sont sélectionnables.'});}
  if(d.players&&new Set(d.players.map(p=>`${p.side}:${p.slot}`)).size!==d.players.length)ctx.addIssue({code:'custom',message:'Un compte par poste.'});
});
export const preferencesSchema=z.object({metrics:z.array(z.enum(['wr','vs','gd15','gold15','kda','cs','xp15','xpd15','dpm','pick','ban','n','kp','vision','objectives'])).min(1).max(15),global:z.boolean(),personal:z.boolean(),filter:filterSchema}).partial();
