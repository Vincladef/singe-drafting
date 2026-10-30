import type { Game,Role } from './types.ts';
import { ROLES } from './types.ts';
export interface ModelArtifact {
  weights:number[];temperature:number;support:Record<string,number>;
  context:{patch:string;queue:number;platform:string;tier:string};
  trainEnd:string;calibrationEnd:string;testEnd:string;
  metrics:{train:number;calibration:number;test:number;brier:number;logLoss:number;ece:number;baselineBrier:number;baselineLogLoss:number};
  eligible:boolean;
}
const DIM=4096;
function index(s:string){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}
const sigmoid=(x:number)=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
export function features(blue:string[],red:string[]){
  const f=new Map<number,number>();
  const add=(key:string,value:number)=>{const h=index(key),i=h%DIM;f.set(i,(f.get(i)||0)+value*((h&0x80000000)?-1:1));};
  for(const [team,sign]of [[blue,1],[red,-1]] as [string[],number][]){
    for(let i=0;i<5;i++)add(`single:${ROLES[i]}:${team[i]}`,sign);
    for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)add(`pair:${i}:${team[i]}:${j}:${team[j]}`,sign*.5);
    for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)for(let k=j+1;k<5;k++)add(`trio:${i}:${team[i]}:${j}:${team[j]}:${k}:${team[k]}`,sign*.25);
  }
  // Antisymmetric confrontations preserve P(A beats B) + P(B beats A) = 1.
  for(let i=0;i<5;i++)for(let j=0;j<5;j++){
    const a=`${i}:${blue[i]}`,b=`${j}:${red[j]}`;if(a===b)continue;
    add(`vs:${[a,b].sort().join('>')}`,(a<b?1:-1)*(i===j?.5:.15));
  }
  return f;
}
function dot(w:number[],f:Map<number,number>){let result=0;for(const [i,x]of f)result+=w[i]*x;return result;}
function teams(g:Game){return [100,200].map(t=>ROLES.map(r=>g.participants.find(p=>p.team===t&&p.role===r)!.champion));}
export function predict(model:ModelArtifact,blue:(string|null)[],red:(string|null)[]){
  if(!model.eligible||blue.some(c=>!c)||red.some(c=>!c))return null;
  if([...blue,...red].some((c,i)=>(model.support[`${ROLES[i%5]}:${c}`]||0)<20))return null;
  return sigmoid(dot(model.weights,features(blue as string[],red as string[]))/model.temperature);
}
export function trainModel(games:Game[]):ModelArtifact|null{
  const unique=[...new Map(games.map(g=>[g.id,g])).values()].sort((a,b)=>a.started-b.started);
  if(unique.length<2500)return null;
  const patch=unique[unique.length-1].patch,queue=unique[unique.length-1].queue;
  const matching=unique.filter(g=>g.patch===patch&&g.queue===queue);
  if(matching.length<2500)return null;
  const trainEnd=Math.floor(matching.length*.6),calEnd=Math.floor(matching.length*.8);
  const records=matching.map(g=>{const [b,r]=teams(g);return {g,f:features(b,r),y:Number(g.participants.find(p=>p.team===100)!.win)};});
  const training=records.slice(0,trainEnd),calibration=records.slice(trainEnd,calEnd),test=records.slice(calEnd);
  const weights=Array(DIM).fill(0),support:Record<string,number>={};
  for(const {g}of training)for(const p of g.participants){const k=`${p.role}:${p.champion}`;support[k]=(support[k]||0)+1;}
  for(let epoch=0;epoch<24;epoch++){
    const rate=.025/(1+epoch*.15);
    for(const {f,y}of training){const error=sigmoid(dot(weights,f))-y;for(const [i,x]of f)weights[i]-=rate*(error*x+.02*weights[i]);}
  }
  // Fit a single temperature on calibration only. Final metrics use untouched later games.
  let temperature=1,bestLoss=Infinity;
  for(let t=.5;t<=5;t+=.1){let loss=0;for(const r of calibration){const p=sigmoid(dot(weights,r.f)/t);loss-=r.y*Math.log(Math.max(p,1e-9))+(1-r.y)*Math.log(Math.max(1-p,1e-9));}if(loss<bestLoss){bestLoss=loss;temperature=t;}}
  const base=(training.reduce((s,r)=>s+r.y,0)+1)/(training.length+2),bins=Array.from({length:10},()=>({n:0,p:0,y:0}));
  let brier=0,loss=0,baselineBrier=0,baselineLogLoss=0;
  for(const r of test){
    const p=sigmoid(dot(weights,r.f)/temperature);brier+=(p-r.y)**2;loss-=r.y*Math.log(Math.max(p,1e-9))+(1-r.y)*Math.log(Math.max(1-p,1e-9));
    baselineBrier+=(base-r.y)**2;baselineLogLoss-=r.y*Math.log(base)+(1-r.y)*Math.log(1-base);
    const b=bins[Math.min(9,Math.floor(p*10))];b.n++;b.p+=p;b.y+=r.y;
  }
  const metrics={train:training.length,calibration:calibration.length,test:test.length,brier:brier/test.length,logLoss:loss/test.length,ece:bins.reduce((s,b)=>s+(b.n?Math.abs(b.p-b.y):0),0)/test.length,baselineBrier:baselineBrier/test.length,baselineLogLoss:baselineLogLoss/test.length};
  return {weights,temperature,support,context:{patch,queue,platform:'all',tier:'all'},trainEnd:new Date(training.at(-1)!.g.started).toISOString(),calibrationEnd:new Date(calibration.at(-1)!.g.started).toISOString(),testEnd:new Date(test.at(-1)!.g.started).toISOString(),metrics,
    eligible:metrics.test>=500&&metrics.ece<=.05&&metrics.brier<Math.min(.25,metrics.baselineBrier)&&metrics.logLoss<metrics.baselineLogLoss};
}
