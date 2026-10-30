import { ROLES,type Draft,type Stat,type Side } from './types.ts';
import { logit } from './statistics.ts';
import { publishedStat,token,pairKey,completeReciprocalMatchups,type OpggSnapshot } from './opgg-data.ts';
import type { PlayerProfile } from './opgg-player.ts';
const missing=()=>publishedStat({});
// Regularized observed frequencies for ranking only. Rounded provider rates never become invented win counts.
export function strength(s:Stat,prior=.5,weight=120){return s.wr===null?prior:((s.n||0)*(s.wr/100)+weight*prior)/((s.n||0)+weight);}
export class Engine{
  catalog;
  constructor(public snapshot:OpggSnapshot,public profiles:Record<string,PlayerProfile>={}){this.catalog=snapshot.champions;completeReciprocalMatchups(snapshot);}
  stat(champion:string,r?:number):Stat{return this.snapshot.stats[r===undefined?champion:token(ROLES[r],champion)]||missing();}
  matchup(c:string,r:number,e:string,er=r){return this.snapshot.matchups[`${token(ROLES[r],c)}>${token(ROLES[er],e)}`]||missing();}
  jointAgainst(_c:string,_r:number,_e:(string|null)[]){return missing();}
  group(team:(string|null)[]){const picks=team.flatMap((c,i)=>c?[token(ROLES[i],c)]:[]);if(picks.length===1)return this.snapshot.stats[picks[0]]||missing();if(picks.length===2)return this.snapshot.synergies[pairKey(...picks as [string,string])]||missing();return missing();}
  observedDuos(team:(string|null)[]){const result:{parts:{champion:string;slot:number}[];stat:Stat}[]=[];for(let a=0;a<5;a++)for(let b=a+1;b<5;b++){if(!team[a]||!team[b])continue;const stat=this.snapshot.synergies[pairKey(token(ROLES[a],team[a]!),token(ROLES[b],team[b]!))];if(stat?.wr!=null)result.push({parts:[{champion:team[a]!,slot:a},{champion:team[b]!,slot:b}],stat});}return result.sort((a,b)=>(b.stat.n||0)-(a.stat.n||0));}
  collective(team:(string|null)[],_against:(string|null)[],_players:Record<number,string>={}){return {allies:this.group(team),duos:this.observedDuos(team),against:missing(),players:missing(),probability:null,probabilityReason:'OP.GG MCP ne fournit pas de probabilité calibrée ni de winrate de composition complète. Aucun taux collectif n’est déduit d’une moyenne.'};}
  personal(player:string|undefined,c:string,_r:number,_enemy?:string|null){const p=player?this.profiles[player]:null;return {champion:p?.champions.find(x=>x.champion===c)?.stat||missing(),overall:p?.overall||missing(),matchup:missing(),context:p?.context||null};}
  score(team:(string|null)[],enemy:(string|null)[],players:Record<number,string>={},trace=false){
    let score=0,evidence=0;const components:any[]=[],missing:any[]=[],present=team.flatMap((c,i)=>c?[{c,i}]:[]);
    const add=(kind:string,champions:string[],stat:Stat,baseline:number,weight:number,value:number)=>{score+=value;if(trace)components.push({kind,champions,stat,baseline,weight,contribution:value,source:kind==='personnel'?'OP.GG profil · saison, tous postes':'OP.GG MCP · All Tiers'});};
    for(const {c,i}of present){const s=this.stat(c,i),base=strength(s);evidence+=s.n||0;add('champion',[c],s,.5,.4,.4*logit(base));
      if(players[i]){const p=this.personal(players[i],c,i).champion;if(p.n)add('personnel',[c],p,base,.4,.4*(logit(strength(p,base,25))-logit(base)));else if(trace)missing.push({kind:'personnel',champions:[c],reason:'Profil ou champion non fourni'});}
      if(enemy[i]){const duel=this.matchup(c,i,enemy[i]!),opponent=strength(this.stat(enemy[i]!,i)),expected=1/(1+Math.exp(-(logit(base)-logit(opponent))));
        if((duel.n||0)>=10&&duel.wr!==null)add('duel',[c,enemy[i]!],duel,expected,.8,.8*(logit(strength(duel,expected,120))-logit(expected)));
        else if(trace)missing.push({kind:'duel',champions:[c,enemy[i]],reason:duel.n===null?'Non fourni en All Tiers':'Moins de 10 parties'});
      }
    }
    for(let a=0;a<present.length;a++)for(let b=a+1;b<present.length;b++){const x=present[a],y=present[b],pair=this.snapshot.synergies[pairKey(token(ROLES[x.i],x.c),token(ROLES[y.i],y.c))];
      if(!pair||(pair.n||0)<20||pair.wr===null){if(trace)missing.push({kind:'duo',champions:[x.c,y.c],reason:!pair?'Non fourni en All Tiers':'Moins de 20 parties'});continue;}
      const baseline=(logit(strength(this.stat(x.c,x.i)))+logit(strength(this.stat(y.c,y.i))))/2,prior=1/(1+Math.exp(-baseline)),weight=.6/Math.max(1,present.length-1);
      add('duo',[x.c,y.c],pair,prior,weight,weight*(logit(strength(pair,prior,180))-baseline));
    }
    return {score,evidence,components,missing};
  }
  recommend(d:Draft,side:Side,players:Record<number,string>={}){
    const slots=d.selected[side].filter(i=>!d[side][i]).sort(),enemy=d[side==='blue'?'red':'blue'];if(!slots.length)return [];
    let beam=[{team:d[side].slice(),score:0,evidence:0}];
    for(const slot of slots){
      const ranked=this.catalog.filter(c=>(this.stat(c.id,slot).n||0)>=30&&this.stat(c.id,slot).wr!==null).map(c=>{const t=d[side].slice();t[slot]=c.id;const score=this.score(t,enemy,players).score;let lift=0;
        for(const [key,p]of Object.entries(this.snapshot.synergies)){const parts=key.split('|'),own=token(ROLES[slot],c.id);if(!parts.includes(own)||(p.n||0)<20)continue;const other=parts.find(x=>x!==own)!,[r,id]=other.split(':'),j=ROLES.indexOf(r as any);if(!slots.includes(j)||j===slot||[...d.blue,...d.red,...d.bans].includes(id)||(this.stat(id,j).n||0)<30)continue;const baseline=(logit(strength(this.stat(c.id,slot)))+logit(strength(this.stat(id,j))))/2;lift=Math.max(lift,.6*(logit(strength(p,1/(1+Math.exp(-baseline)),180))-baseline));}
        return {c,score,potential:score+lift};});
      const pool=[...new Map([...ranked.sort((a,b)=>b.score-a.score).slice(0,24),...ranked.sort((a,b)=>b.potential-a.potential).slice(0,12)].map(x=>[x.c.id,x])).values()];
      const next:typeof beam=[];for(const item of beam)for(const {c}of pool){if([...item.team,...enemy,...d.bans].includes(c.id))continue;const team=item.team.slice();team[slot]=c.id;next.push({team,...this.score(team,enemy,players)});}next.sort((a,b)=>b.score-a.score||a.team.join().localeCompare(b.team.join()));beam=next.slice(0,64);
    }
    return beam.slice(0,3).map((b,i)=>({rank:i+1,parts:Object.fromEntries(slots.map(s=>[s,b.team[s]])),rankingScore:b.score,evidenceTrace:this.score(b.team,enemy,players,true),collective:this.collective(b.team,enemy,players),proposedGroup:this.group(b.team.map((c,s)=>slots.includes(s)?c:null)),sample:Math.min(...slots.map(s=>this.stat(b.team[s]!,s).n||0)),explanation:'Score heuristique : base champion ×0,4, duels ×0,8 corrigés du niveau statistique adverse, duos régularisés et normalisés par taille d’équipe, personnel ×0,4. Détail vérifiable ci-dessous ; aucune probabilité prédite.',stats:slots.map(s=>({slot:s,champion:b.team[s],stat:this.stat(b.team[s]!,s)}))}));
  }
  analyze(d:Draft,players:{blue:Record<number,string>;red:Record<number,string>}={blue:{},red:{}}){
    const cards=Object.fromEntries((['blue','red'] as Side[]).map(side=>[side,d[side].map((c,i)=>c?{champion:c,global:this.stat(c),role:this.stat(c,i),matchup:d[side==='blue'?'red':'blue'][i]?this.matchup(c,i,d[side==='blue'?'red':'blue'][i]!):missing(),personal:this.personal(players[side][i],c,i),jointAgainst:missing(),cross:d[side==='blue'?'red':'blue'].flatMap((e,j)=>e?[{champion:e,role:ROLES[j],stat:this.matchup(c,i,e,j)}]:[])}:null)]));
    return {cards,recommendations:{blue:this.recommend(d,'blue',players.blue),red:this.recommend(d,'red',players.red)},collective:{blue:this.collective(d.blue,d.red),red:this.collective(d.red,d.blue)},context:{...this.snapshot.context,games:null,computedAt:new Date().toISOString(),stale:Date.now()-Date.parse(this.snapshot.context.fetchedAt)>21600000,coveredChampions:this.snapshot.completed.length,totalChampions:this.catalog.length,sampling:'Agrégats OP.GG MCP, All Tiers. Périmètre régional et période non précisés. Taux parfois arrondis par le fournisseur ; IC calculés seulement si victoires et parties exactes sont fournis.',rankDefinition:'All Tiers : paramètre tier omis selon le contrat officiel du MCP.'},probability:null,modelStatus:'unavailable'};
  }
}
