import { ROLES,type Draft,type Stat,type Side } from './types.ts';
import { logit } from './statistics.ts';
import { publishedStat,token,pairKey,type OpggSnapshot } from './opgg-data.ts';
import type { PlayerProfile } from './opgg-player.ts';
const missing=()=>publishedStat({});
// Regularized observed frequencies for ranking only. Rounded provider rates never become invented win counts.
export function strength(s:Stat,prior=.5,weight=120){return s.wr===null?prior:((s.n||0)*(s.wr/100)+weight*prior)/((s.n||0)+weight);}
export class Engine{
  catalog;
  constructor(public snapshot:OpggSnapshot,public profiles:Record<string,PlayerProfile>={}){this.catalog=snapshot.champions;}
  stat(champion:string,r?:number):Stat{return this.snapshot.stats[r===undefined?champion:token(ROLES[r],champion)]||missing();}
  matchup(c:string,r:number,e:string,er=r){return this.snapshot.matchups[`${token(ROLES[r],c)}>${token(ROLES[er],e)}`]||missing();}
  jointAgainst(_c:string,_r:number,_e:(string|null)[]){return missing();}
  group(team:(string|null)[]){const picks=team.flatMap((c,i)=>c?[token(ROLES[i],c)]:[]);if(picks.length===1)return this.snapshot.stats[picks[0]]||missing();if(picks.length===2)return this.snapshot.synergies[pairKey(...picks as [string,string])]||missing();return missing();}
  collective(team:(string|null)[],_against:(string|null)[],_players:Record<number,string>={}){return {allies:this.group(team),against:missing(),players:missing(),probability:null,probabilityReason:'OP.GG MCP ne fournit pas de probabilité calibrée ni de winrate de composition complète. Aucun taux collectif n’est déduit d’une moyenne.'};}
  personal(player:string|undefined,c:string,_r:number,_enemy?:string|null){const p=player?this.profiles[player]:null;return {champion:p?.champions.find(x=>x.champion===c)?.stat||missing(),overall:p?.overall||missing(),matchup:missing(),context:p?.context||null};}
  score(team:(string|null)[],enemy:(string|null)[],players:Record<number,string>={}){
    let score=0,evidence=0;const present=team.flatMap((c,i)=>c?[{c,i}]:[]);
    for(const {c,i}of present){const s=this.stat(c,i),base=strength(s);score+=logit(base);evidence+=s.n||0;
      if(players[i]){const p=this.personal(players[i],c,i).champion;if(p.n)score+=.65*(logit(strength(p,base,25))-logit(base));}
      if(enemy[i]){const duel=this.matchup(c,i,enemy[i]!);if((duel.n||0)>=10)score+=.35*(logit(strength(duel,base,120))-logit(base));}
    }
    for(let a=0;a<present.length;a++)for(let b=a+1;b<present.length;b++){const x=present[a],y=present[b],pair=this.snapshot.synergies[pairKey(token(ROLES[x.i],x.c),token(ROLES[y.i],y.c))];if(!pair||(pair.n||0)<20)continue;const baseline=(logit(strength(this.stat(x.c,x.i)))+logit(strength(this.stat(y.c,y.i))))/2,prior=1/(1+Math.exp(-baseline));score+=.3*(logit(strength(pair,prior,180))-baseline);}
    return {score,evidence};
  }
  recommend(d:Draft,side:Side,players:Record<number,string>={}){
    const slots=d.selected[side].filter(i=>!d[side][i]).sort(),enemy=d[side==='blue'?'red':'blue'];if(!slots.length)return [];
    let beam=[{team:d[side].slice(),score:0,evidence:0}];
    for(const slot of slots){
      const pool=this.catalog.filter(c=>(this.stat(c.id,slot).n||0)>=30&&this.stat(c.id,slot).wr!==null).map(c=>{const t=d[side].slice();t[slot]=c.id;return {c,score:this.score(t,enemy,players).score};}).sort((a,b)=>b.score-a.score).slice(0,24);
      const next:typeof beam=[];for(const item of beam)for(const {c}of pool){if([...item.team,...enemy,...d.bans].includes(c.id))continue;const team=item.team.slice();team[slot]=c.id;next.push({team,...this.score(team,enemy,players)});}next.sort((a,b)=>b.score-a.score||a.team.join().localeCompare(b.team.join()));beam=next.slice(0,64);
    }
    return beam.slice(0,3).map((b,i)=>({rank:i+1,parts:Object.fromEntries(slots.map(s=>[s,b.team[s]])),rankingScore:b.score,collective:this.collective(b.team,enemy,players),sample:Math.min(...slots.map(s=>this.stat(b.team[s]!,s).n||0)),explanation:'Classement régularisé par poste, duels disponibles, duos observés et performances personnelles associées. Les interactions manquantes ne sont pas inventées. Ce score n’est pas une probabilité.',stats:slots.map(s=>({slot:s,champion:b.team[s],stat:this.stat(b.team[s]!,s)}))}));
  }
  analyze(d:Draft,players:{blue:Record<number,string>;red:Record<number,string>}={blue:{},red:{}}){
    const cards=Object.fromEntries((['blue','red'] as Side[]).map(side=>[side,d[side].map((c,i)=>c?{champion:c,global:this.stat(c),role:this.stat(c,i),matchup:d[side==='blue'?'red':'blue'][i]?this.matchup(c,i,d[side==='blue'?'red':'blue'][i]!):missing(),personal:this.personal(players[side][i],c,i),jointAgainst:missing(),cross:d[side==='blue'?'red':'blue'].flatMap((e,j)=>e?[{champion:e,role:ROLES[j],stat:this.matchup(c,i,e,j)}]:[])}:null)]));
    return {cards,recommendations:{blue:this.recommend(d,'blue',players.blue),red:this.recommend(d,'red',players.red)},collective:{blue:this.collective(d.blue,d.red),red:this.collective(d.red,d.blue)},context:{...this.snapshot.context,games:null,computedAt:new Date().toISOString(),stale:Date.now()-Date.parse(this.snapshot.context.fetchedAt)>21600000,coveredChampions:this.snapshot.completed.length,totalChampions:this.catalog.length,sampling:'Agrégats OP.GG MCP, All Tiers. Périmètre régional et période non précisés. Taux parfois arrondis par le fournisseur ; IC calculés seulement si victoires et parties exactes sont fournis.',rankDefinition:'All Tiers : paramètre tier omis selon le contrat officiel du MCP.'},probability:null,modelStatus:'unavailable'};
  }
}
