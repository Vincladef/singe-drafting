import { ROLES } from './types.ts';
import type { Champion, Draft, Game, Participant, Side, Stat } from './types.ts';
import { logit, observed, posterior, summarize } from './statistics.ts';

type Row={p:Participant;g:Game};
type Count={n:number;wins:number};
const add=(map:Map<string,Count>,key:string,win:boolean)=>{const v=map.get(key)||{n:0,wins:0};v.n++;v.wins+=Number(win);map.set(key,v);};
const token=(p:Pick<Participant,'role'|'champion'>)=>`${p.role}:${p.champion}`;
const key=(parts:string[])=>parts.slice().sort().join('|');
export class Engine {
  rows:Row[]=[];
  single=new Map<string,Row[]>();
  matchups=new Map<string,Row[]>();
  groups=new Map<string,Count>();
  playerRows=new Map<string,Row[]>();
  stats=new Map<string,Stat>();
  jointCounters=new Map<string,Count>();
  constructor(public games:Game[],public catalog:Champion[],public fullStats:Record<string,Stat>={}){
    for(const g of games){
      for(const p of g.participants){
        const row={p,g};this.rows.push(row);
        for(const k of [p.champion,token(p)]){const list=this.single.get(k)||[];list.push(row);this.single.set(k,list);}
        if(p.player){const list=this.playerRows.get(p.player)||[];list.push(row);this.playerRows.set(p.player,list);}
        for(const enemy of g.participants.filter(e=>e.team!==p.team)){
          const k=`${token(p)}>${token(enemy)}`;const list=this.matchups.get(k)||[];list.push(row);this.matchups.set(k,list);
        }
      }
      for(const teamId of [100,200]){
        const team=g.participants.filter(p=>p.team===teamId);
        // All role-aware duos/trios/4/5 groups, counted once per team-match.
        for(let mask=1;mask<32;mask++){
          const subset=team.filter((_,i)=>(mask&(1<<i))!==0);if(subset.length<2)continue;
          add(this.groups,key(subset.map(token)),team[0].win);
        }
      }
    }
  }
  stat(champion:string,role?:number):Stat{
    const k=role===undefined?champion:`${ROLES[role]}:${champion}`;
    if(this.fullStats[k])return this.fullStats[k];
    if(!this.stats.has(k))this.stats.set(k,summarize(this.single.get(k)||[],this.games.length,this.games.filter(g=>g.bans.includes(champion)).length));
    return this.stats.get(k)!;
  }
  matchup(champion:string,role:number,enemy:string,enemyRole=role){
    return summarize(this.matchups.get(`${ROLES[role]}:${champion}>${ROLES[enemyRole]}:${enemy}`)||[]);
  }
  jointAgainst(champion:string,role:number,enemy:(string|null)[]){
    const k=`${ROLES[role]}:${champion}>${enemy.map((c,i)=>c?`${i}:${c}`:'').join('|')}`;
    if(!this.jointCounters.has(k)){
      const rows=(this.single.get(`${ROLES[role]}:${champion}`)||[]).filter(({p,g})=>enemy.every((c,i)=>!c||g.participants.some(e=>e.team!==p.team&&e.role===ROLES[i]&&e.champion===c)));
      this.jointCounters.set(k,{n:rows.length,wins:rows.filter(r=>r.p.win).length});
    }
    const c=this.jointCounters.get(k)!;return observed(c.wins,c.n);
  }
  group(team:(string|null)[]){
    const tokens=team.flatMap((c,i)=>c?[`${ROLES[i]}:${c}`]:[]);
    if(!tokens.length)return observed(0,0);
    if(tokens.length===1){const rows=this.single.get(tokens[0])||[];return observed(rows.filter(r=>r.p.win).length,rows.length);}
    const c=this.groups.get(key(tokens));return observed(c?.wins||0,c?.n||0);
  }
  collective(team:(string|null)[],against:(string|null)[],players:Record<number,string>={}){
    let n=0,wins=0,personalN=0,personalWins=0;
    for(const g of this.games)for(const t of [100,200]){
      const own=g.participants.filter(p=>p.team===t),opp=g.participants.filter(p=>p.team!==t);
      const matches=(requested:(string|null)[],actual:Participant[])=>requested.every((c,i)=>!c||actual.some(p=>p.role===ROLES[i]&&p.champion===c));
      if(!team.some(Boolean)||!matches(team,own)||!matches(against,opp))continue;
      n++;wins+=Number(own[0].win);
      if(Object.entries(players).length&&Object.entries(players).every(([i,h])=>own.some(p=>p.role===ROLES[+i]&&p.player===h))){personalN++;personalWins+=Number(own[0].win);}
    }
    return {allies:this.group(team),against:observed(wins,n),players:observed(personalWins,personalN),
      probability:null,probabilityReason:'Aucun modèle calibré validé sur des matchs distincts. Le classement est un score de préférence, pas une probabilité.'};
  }
  personal(player:string|undefined,champion:string,role:number,enemy?:string|null){
    const all=player?this.playerRows.get(player)||[]:[];
    const rows=all.filter(r=>r.p.champion===champion&&r.p.role===ROLES[role]);
    return {champion:summarize(rows),overall:summarize(all),matchup:summarize(enemy?rows.filter(({p,g})=>g.participants.some(e=>e.team!==p.team&&e.role===p.role&&e.champion===enemy)):[])};
  }
  score(team:(string|null)[],enemy:(string|null)[],players:Record<number,string>={}){
    let score=0,evidence=0;
    const present=team.flatMap((champion,role)=>champion?[{champion,role}]:[]);
    for(const {champion,role} of present){
      const s=this.stat(champion,role),base=posterior(s.wins,s.n);score+=logit(base);evidence+=s.n;
      const player=players[role];if(player){const p=this.personal(player,champion,role).champion;if(p.n)score+=.65*(logit(posterior(p.wins,p.n,base,25))-logit(base));}
      for(let j=0;j<enemy.length;j++)if(enemy[j]){
        const duel=this.matchup(champion,role,enemy[j]!,j);
        // Conditional lifts with strong shrinkage; correlated counters are deliberately discounted.
        if(duel.n>=10)score+=(j===role?.35:.08)*(logit(posterior(duel.wins,duel.n,base,120))-logit(base));
      }
      if(enemy.filter(Boolean).length>1){const joint=this.jointAgainst(champion,role,enemy);if(joint.n>=20)score+=.25*(logit(posterior(joint.wins,joint.n,base,240))-logit(base));}
    }
    for(let a=0;a<present.length;a++)for(let b=a+1;b<present.length;b++){
      const pair=[present[a],present[b]],c=this.groups.get(key(pair.map(p=>`${ROLES[p.role]}:${p.champion}`)));
      if(!c||c.n<20)continue;
      const baseline=pair.reduce((s,p)=>{const st=this.stat(p.champion,p.role);return s+logit(posterior(st.wins,st.n));},0)/2;
      const prior=1/(1+Math.exp(-baseline));score+=.3*(logit(posterior(c.wins,c.n,prior,180))-baseline);
    }
    for(let a=0;a<present.length;a++)for(let b=a+1;b<present.length;b++)for(let c=b+1;c<present.length;c++){
      const trio=[present[a],present[b],present[c]],obs=this.groups.get(key(trio.map(p=>`${ROLES[p.role]}:${p.champion}`)));
      if(!obs||obs.n<40)continue;
      const baseline=trio.reduce((s,p)=>{const st=this.stat(p.champion,p.role);return s+logit(posterior(st.wins,st.n));},0)/3;
      score+=.15*(logit(posterior(obs.wins,obs.n,1/(1+Math.exp(-baseline)),300))-baseline);
    }
    if(present.length>=4){const group=this.group(team);if(group.n>=50){const baseline=present.reduce((s,p)=>{const st=this.stat(p.champion,p.role);return s+logit(posterior(st.wins,st.n));},0)/present.length;score+=.25*(logit(posterior(group.wins,group.n,1/(1+Math.exp(-baseline)),500))-baseline);}}
    return {score,evidence};
  }
  recommend(draft:Draft,side:Side,players:Record<number,string>={}){
    const slots=draft.selected[side].filter(i=>!draft[side][i]).sort((a,b)=>a-b),enemy=draft[side==='blue'?'red':'blue'];
    if(!slots.length)return [];
    let beam=[{team:draft[side].slice(),score:0,evidence:0}];
    for(const slot of slots){
      const pool=this.catalog.filter(c=>this.stat(c.id,slot).n>=30).sort((a,b)=>{
        const aa=this.stat(a.id,slot),bb=this.stat(b.id,slot);
        return posterior(bb.wins,bb.n)-posterior(aa.wins,aa.n);
      }).slice(0,24);
      if(!pool.length)return [];
      const next:typeof beam=[];
      for(const item of beam)for(const c of pool){
        if([...item.team,...enemy,...draft.bans].includes(c.id))continue;
        const team=item.team.slice();team[slot]=c.id;next.push({team,...this.score(team,enemy,players)});
      }
      next.sort((a,b)=>b.score-a.score||key(a.team.filter(Boolean) as string[]).localeCompare(key(b.team.filter(Boolean) as string[])));
      beam=next.slice(0,64);
    }
    return beam.slice(0,3).map((b,i)=>({rank:i+1,parts:Object.fromEntries(slots.map(s=>[s,b.team[s]])),
      rankingScore:b.score,collective:this.collective(b.team,enemy,players),
      sample:Math.min(...slots.map(s=>this.stat(b.team[s]!,s).n)),
      explanation:`Classement régularisé selon les performances par poste, les duels et les duos/trios suffisamment documentés. Recherche approchée (24 candidats/poste, faisceau de 64).`,
      stats:slots.map(s=>({slot:s,champion:b.team[s],stat:this.stat(b.team[s]!,s)}))}));
  }
  analyze(draft:Draft,players:{blue:Record<number,string>;red:Record<number,string>}={blue:{},red:{}}){
    const cards=Object.fromEntries((['blue','red'] as Side[]).map(side=>[side,draft[side].map((c,i)=>c?{
      champion:c,global:this.stat(c),role:this.stat(c,i),
      matchup:draft[side==='blue'?'red':'blue'][i]?this.matchup(c,i,draft[side==='blue'?'red':'blue'][i]!):summarize([]),
      personal:this.personal(players[side][i],c,i,draft[side==='blue'?'red':'blue'][i]),
      jointAgainst:this.jointAgainst(c,i,draft[side==='blue'?'red':'blue']),
      cross: draft[side==='blue'?'red':'blue'].flatMap((e,j)=>e?[{champion:e,role:ROLES[j],stat:this.matchup(c,i,e,j)}]:[])
    }:null)]));
    return {cards,recommendations:{blue:this.recommend(draft,'blue',players.blue),red:this.recommend(draft,'red',players.red)},
      collective:{blue:this.collective(draft.blue,draft.red,players.blue),red:this.collective(draft.red,draft.blue,players.red)},
      context:{...draft.filter,source:'Riot Match-V5 + Timeline',games:this.games.length,
        oldest:this.games.length?new Date(Math.min(...this.games.map(g=>g.started))).toISOString():null,
        newest:this.games.length?new Date(Math.max(...this.games.map(g=>g.started))).toISOString():null,
        sampleLimit:5000,computedAt:new Date().toISOString(),snapshotMaxAgeSeconds:180,sampling:'Échantillon de comptes déclarés et de pages du classement ; biais de sélection. Aucun rang historique fourni par Riot.',
        rankDefinition:'Un filtre de rang conserve seulement les matchs dont les dix participants ont ce rang observé ; ce rang est actuel, pas historique.'},
      probability:null,modelStatus:'unvalidated'};
  }
}
