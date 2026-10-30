import type { Config, Context } from '@netlify/functions';
import { z } from 'zod';
import { db,cached,env,hash,quota } from '../../server/db.ts';
import { HttpError,jsonBody,sameOrigin,userId } from '../../server/auth.ts';
import { draftSchema,preferencesSchema } from '../../server/validation.ts';
import { analyze,catalog } from '../../server/service.ts';
import { identify,enqueue,PLATFORMS,RiotError } from '../../server/riot.ts';
import { ask } from '../../server/ai.ts';
import { summarize } from '../../server/statistics.ts';
import { dataset,personalDataset } from '../../server/dataset.ts';
import { importMatch,refreshAccount } from '../../server/ingest.ts';
import { riot,routing } from '../../server/riot.ts';
import { buildInfo } from '../../server/build-info.ts';
import { activeGame } from '../../server/live.ts';

const uuid=z.uuid();
export default async (req:Request,context:Context)=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
  const json=(v:unknown,status=200)=>Response.json(v,{status,headers});
  try{
    sameOrigin(req);const path=new URL(req.url).pathname.replace(/^\/api\/?/,'');
    if(path==='config'&&req.method==='GET')return json({authUrl:env('NEON_AUTH_BASE_URL'),platforms:Object.keys(PLATFORMS),model:'gpt-6-luna'});
    if(path==='catalog'&&req.method==='GET')return json(await catalog());
    if(path==='health'&&req.method==='GET'){
      const [providers,matches]=await Promise.all([db()`select provider,status,details,checked_at from drafting.provider_status`,db()`select count(*)::int as count,max(imported_at) as refreshed_at from drafting.matches`]);
      return json({ok:true,version:'1.0.0',commit:env('COMMIT_REF')||buildInfo.commit,database:'reachable',matches:matches[0],providers,riotPublication:'Une réponse API valide ne prouve pas l’autorisation de publication. À confirmer dans le portail Riot.',rso:'not_configured'});
    }
    if(path==='metadata'&&req.method==='GET'){
      const [patches,regions]=await Promise.all([db()`select patch,count(*)::int as games from drafting.matches group by patch order by max(started_at) desc limit 20`,db()`select platform,count(*)::int as games from drafting.matches group by platform`]);
      return json({patches,regions});
    }
    if(path==='analyze'&&req.method==='POST'){
      const draft=draftSchema.parse(await jsonBody(req)),user=await userId(req,false);
      if(!await quota(`analyze:${hash(context.ip||'unknown')}`,180,60))throw new HttpError(429,'Trop de modifications rapprochées. Réessaie dans un instant.');
      return json((await analyze(draft,user)).result);
    }
    if(path==='live'&&req.method==='POST'){
      if(!await quota(`live:${hash(context.ip||'unknown')}`,12,600))throw new HttpError(429,'Trop de recherches rapprochées. Réessaie dans quelques instants.');
      const input=z.object({riotId:z.string().trim().min(3).max(60),platform:z.enum(Object.keys(PLATFORMS) as [string,...string[]])}).parse(await jsonBody(req));
      return json(await activeGame(input.riotId,input.platform,(await catalog()).champions));
    }
    if(path==='coverage'&&req.method==='GET'){
      const [counts,collector]=await Promise.all([
        db()`select count(*)::int as total,count(*) filter(where started_at>now()-interval '30 days')::int as recent,max(imported_at) as lastImport from drafting.matches`,
        db()`select status,details,checked_at from drafting.provider_status where provider='collection_worker'`
      ]);
      return json({source:'Riot Match-V5 + Timeline',scope:'collected_sample',...counts[0],collector:collector[0]||null,representative:false,globalProvider:false});
    }
    const user=(await userId(req))!;
    await db()`insert into drafting.profiles(user_id) values(${user}) on conflict do nothing`;
    if(path==='profile'&&req.method==='GET'){
      const [profile,accounts]=await Promise.all([db()`select preferences from drafting.profiles where user_id=${user}`,db()`select id,game_name,tag_line,platform,identity_kind,rank_data,mastery,refreshed_at from drafting.riot_accounts where user_id=${user} order by created_at`]);
      return json({preferences:profile[0]?.preferences||{},accounts});
    }
    if(path==='profile'&&req.method==='PUT'){
      const preferences=preferencesSchema.parse(await jsonBody(req));
      await db()`update drafting.profiles set preferences=${JSON.stringify(preferences)}::jsonb,updated_at=now() where user_id=${user}`;return json({ok:true});
    }
    if(path==='profile'&&req.method==='DELETE'){
      await db()`delete from drafting.jobs where payload->>'accountId' in (select id::text from drafting.riot_accounts where user_id=${user})`;
      await db()`delete from drafting.cache where key like ${'ai:'+hash(user)+':%'}`;
      await db()`delete from drafting.profiles where user_id=${user}`;return json({ok:true});
    }
    if(path==='accounts'&&req.method==='POST'){
      if(!await quota(`account:${hash(user)}`,10))throw new HttpError(429,'Limite de recherches Riot atteinte pour cette heure.');
      const input=z.object({riotId:z.string().min(3).max(60),platform:z.enum(Object.keys(PLATFORMS) as [string,...string[]]),visibleIdentity:z.literal(true)}).parse(await jsonBody(req));
      const count=await db()`select count(*)::int as n from drafting.riot_accounts where user_id=${user}`;
      if(count[0].n>=10)throw new HttpError(400,'Dix comptes maximum. Retire un compte pour en ajouter un autre.');
      const a=await identify(input.riotId,input.platform);
      const rows=await db()`insert into drafting.riot_accounts(user_id,puuid,game_name,tag_line,platform) values(${user},${a.puuid},${a.gameName},${a.tagLine},${input.platform}) on conflict(user_id,puuid,platform) do update set game_name=excluded.game_name,tag_line=excluded.tag_line returning id`;
      await enqueue(a.puuid,input.platform,rows[0].id);return json({ok:true,id:rows[0].id,status:'pending',identityKind:'declared'},202);
    }
    if(path.match(/^accounts\/[\w-]+\/sync$/)&&req.method==='POST'){
      const id=uuid.parse(path.split('/')[1]);
      if(!await quota(`sync:${hash(user)}`,6))throw new HttpError(429,'Historique déjà demandé récemment. La collecte continue en arrière-plan.');
      const rows=await db()`select * from drafting.riot_accounts where id=${id} and user_id=${user}`;
      const account=rows[0];if(!account)throw new HttpError(404,'Compte introuvable.');
      const ids=await riot<string[]>(routing(account.platform),`/lol/match/v5/matches/by-puuid/${encodeURIComponent(account.puuid)}/ids?start=0&count=5&type=ranked`,60);
      let imported=0;for(const matchId of ids)if(await importMatch(matchId,account.platform,(await catalog()).champions))imported++;
      await db()`delete from drafting.cache where key like 'dataset:%' or key like 'aggregates:%'`;
      return json({imported,status:'collecting'});
    }
    if(path.match(/^accounts\/[\w-]+$/)){
      const id=uuid.parse(path.split('/')[1]);const accounts=await db()`select * from drafting.riot_accounts where id=${id} and user_id=${user}`;
      if(!accounts[0])throw new HttpError(404,'Compte introuvable.');
      if(req.method==='DELETE'){
        await db()`delete from drafting.jobs where payload->>'accountId'=${id}`;
        await db()`delete from drafting.riot_accounts where id=${id} and user_id=${user}`;return json({ok:true});
      }
      if(req.method==='POST'){
        if(!await quota(`refresh:${hash(user)}`,6))throw new HttpError(429,'Actualisation déjà demandée récemment.');
        await enqueue(accounts[0].puuid,accounts[0].platform,id);return json({ok:true,status:'pending'},202);
      }
      if(req.method==='GET'){
        const filter={patch:'all',platform:accounts[0].platform,queue:420,days:90,tier:'all'};
        const player=hash(accounts[0].puuid);const games=await personalDataset(filter,[player]);
        const rows=games.flatMap(g=>g.participants.filter(p=>p.player===player).map(p=>({p,g})));
        const champs=[...new Set(rows.map(r=>r.p.champion))];
        return json({overall:summarize(rows),champions:champs.map(champion=>({champion,stat:summarize(rows.filter(r=>r.p.champion===champion))})).sort((a,b)=>b.stat.n-a.stat.n),recent:rows.sort((a,b)=>b.g.started-a.g.started).slice(0,10).map(r=>({champion:r.p.champion,win:r.p.win,date:new Date(r.g.started).toISOString()})),context:filter});
      }
    }
    if(path==='drafts'&&req.method==='GET')return json(await db()`select id,name,state,updated_at from drafting.drafts where user_id=${user} order by updated_at desc limit 100`);
    if(path==='drafts'&&req.method==='POST'){
      const body=z.object({name:z.string().min(1).max(80),state:draftSchema}).parse(await jsonBody(req));
      const count=await db()`select count(*)::int as n from drafting.drafts where user_id=${user}`;
      if(count[0].n>=100)throw new HttpError(400,'Historique plein (100 drafts). Supprime une ancienne draft.');
      const rows=await db()`insert into drafting.drafts(user_id,name,state) values(${user},${body.name},${JSON.stringify(body.state)}::jsonb) returning id`;return json(rows[0],201);
    }
    if(path.match(/^drafts\/[\w-]+$/)&&req.method==='DELETE'){
      const id=uuid.parse(path.split('/')[1]);await db()`delete from drafting.drafts where id=${id} and user_id=${user}`;return json({ok:true});
    }
    if(path==='ask'&&req.method==='POST'){
      const b=z.object({draft:draftSchema,question:z.string().trim().min(1).max(500)}).parse(await jsonBody(req));return json(await ask(user,b.draft,b.question));
    }
    return json({error:'Page API introuvable.'},404);
  }catch(e){
    if(e instanceof z.ZodError)return json({error:e.issues[0]?.message||'Données invalides.'},400);
    if(e instanceof HttpError)return json({error:e.message},e.status);
    if(e instanceof RiotError)return json({error:e.status===404?'Riot ID introuvable dans cette région.':e.status===429?'Riot limite les requêtes. Réessaie plus tard.':e.status===403||e.status===401?'La clé Riot est refusée ou expirée. La draft reste accessible.':'Le service Riot est indisponible.',retryAfter:e.retryAfter},e.status===404?404:503);
    // Never send provider bodies, connection strings, or raw errors to clients/logs.
    return json({error:'Service momentanément indisponible. Ta draft reste conservée dans ce navigateur.'},503);
  }
};
export const config:Config={path:'/api/*',rateLimit:{action:'rate_limit',aggregateBy:'ip',windowLimit:300,windowSize:60}};
