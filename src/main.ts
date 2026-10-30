import './mockup.css';
import './extra.css';
import { createAuthClient } from '@neondatabase/auth';
import { BetterAuthVanillaAdapter } from '@neondatabase/auth/vanilla/adapters';
const makeAuth=(url:string)=>createAuthClient(url,{adapter:BetterAuthVanillaAdapter()});
import fallback from './champions-fallback.json';
import type { Champion, Draft, Side, Stat } from '../server/types.ts';
import { ROLES } from '../server/types.ts';

const $=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const norm=(s:string)=>s.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/gi,'').toLowerCase();
let champions:Champion[]=fallback,mode='manual',analysis:any=null;
let auth:ReturnType<typeof makeAuth>|null=null,user:{id:string;name:string}|null=null,accounts:any[]=[];
let authReady:Promise<void>;
let myAccountId='',myRole=1;
let globalOn=true,personalOn=false,shown=['wr','vs','gd15'];
let draft:Draft={blue:Array(5).fill(null),red:Array(5).fill(null),selected:{blue:[0,1,2,3,4],red:[0,1,2,3,4]},bans:[],players:[],filter:{patch:'all',platform:'all',queue:420,days:30,tier:'all'}};
let sequence=0,timer:ReturnType<typeof setTimeout>,controller:AbortController|null=null,preferenceTimer:ReturnType<typeof setTimeout>;
const metrics:Record<string,string>={wr:'Winrate au poste',vs:'Winrate du duel',gd15:'Δ or à 15 min',gold15:'Or à 15 min',kda:'KDA',cs:'CS / min',xp15:'XP à 15 min',xpd15:'Δ XP à 15 min',dpm:'Dégâts / min',pick:'Pickrate',ban:'Banrate',n:'Parties',kp:'Participation aux kills',vision:'Vision',objectives:'Objectifs'};
const icons=['♜','✣','✦','➶','✚'];
const name=(id:string)=>champions.find(c=>c.id===id)?.name||id;
const image=(id:string)=>`/assets/champions/${encodeURIComponent(id)}.png`;
const photo=(id:string|null)=>id?`<span>${esc(name(id).slice(0,2))}</span><img loading="lazy" src="${image(id)}" alt="">`:'<span>+</span>';
const format=(n:number|null|undefined,digits=1)=>n===null||n===undefined||!Number.isFinite(n)?'—':n.toLocaleString('fr-FR',{maximumFractionDigits:digits,minimumFractionDigits:digits});
function value(s:any,k:string){
  if(!s||!s.n)return '—';const v=s[k];if(v===null||v===undefined)return '—';
  if(['wr','pick','ban','kp'].includes(k))return format(v)+' %';
  if(['n','gold15','xp15','gd15','xpd15','dpm'].includes(k))return (['gd15','xpd15'].includes(k)&&v>0?'+':'')+format(v,0);
  return format(v);
}
const interval=(s:any)=>s?.interval?`${format(s.interval[0])}–${format(s.interval[1])} %`:'indisponible';
function toast(message:string){$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,5000);}
async function api(path:string,options:RequestInit={},privateRequest=false){
  const headers=new Headers(options.headers);if(options.body)headers.set('content-type','application/json');
  if(user&&auth){
    const t=await auth.token();if(t.data?.token)headers.set('authorization',`Bearer ${t.data.token}`);
    else if(privateRequest)throw new Error('Session expirée. Reconnecte-toi.');
  }else if(privateRequest)throw new Error('Connecte-toi avec Google pour utiliser cette fonction.');
  const res=await fetch(`/api/${path}`,{...options,headers});
  const data=await res.json().catch(()=>({error:'Service indisponible.'}));
  if(!res.ok)throw new Error(data.error||'Service indisponible.');return data;
}
function page(which:string){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('on',p.id===`page-${which}`));$('back').hidden=which==='home';window.scrollTo({top:0,behavior:'instant'});}
function begin(nextMode:string){mode=nextMode;page('draft');$('live-note').hidden=mode!=='live';$('draft-mode').textContent=mode==='live'?'PARTIE EN DIRECT · RECHERCHE RIOT':'DRAFT MANUELLE';if(mode==='live')draft.players=[];renderRows();schedule();if(mode==='live')showIdentitySetup('live');}
function persist(){
  try{localStorage.setItem('singe:draft:v1',JSON.stringify({...draft,players:[]}));}catch{}
}
function savePreferences(){
  if(!user)return;clearTimeout(preferenceTimer);preferenceTimer=setTimeout(()=>api('profile',{method:'PUT',body:JSON.stringify({metrics:shown,global:globalOn,personal:personalOn,filter:draft.filter,...(myAccountId?{primaryAccountId:myAccountId,myRole}:{})})},true).catch(e=>toast(e.message)),800);
}
function statBlock(side:Side,slot:number){
  if(!draft[side][slot]||(!globalOn&&!personalOn))return '';
  const card=analysis?.cards?.[side]?.[slot];
  const associated=draft.players?.some(p=>p.side===side&&p.slot===slot);
  const sources=[...(globalOn?[{s:card?.role,title:'CORPUS COLLECTÉ',personal:false}]:[]),...(personalOn&&associated?[{s:card?.personal.champion,title:'JOUEUR ASSOCIÉ',personal:true}]:[])];
  return `<div class="two-src">${sources.map(({s,title,personal})=>`<div class="line-src"><div class="line-heading"><span class="src-label ${personal?'mine':''}">${title}</span><span class="src-n">${format(s?.n||0,0)} matchs</span></div><div class="metrics">${shown.map(k=>{
    const st=k==='vs'?(personal?card?.personal.matchup:card?.matchup):s;
    const insufficient=!personal&&(st?.n||0)<30;
    return `<span class="metric" title="${esc(metrics[k])} · n=${st?.n||0} · IC 95 % ${interval(st)}${insufficient?' · échantillon insuffisant':''}"><strong>${insufficient?'—':value(st,k==='vs'?'wr':k)}</strong><small>${insufficient?'Échantillon < 30':esc(metrics[k])}</small></span>`;
  }).join('')}</div></div>`).join('')}</div>`;
}
function slotHtml(side:Side,i:number){
  const id=draft[side][i],right=side==='red',selected=draft.selected[side].includes(i),player=draft.players?.find(p=>p.side===side&&p.slot===i),account=accounts.find(a=>a.id===player?.accountId);
  const toggle=id?'<span class="edge-spacer"></span>':`<label class="edge-check"><input class="slot-analyze" type="checkbox" data-side="${side}" data-slot="${i}" aria-label="Optimiser ${ROLES[i]} ${right?'adverse':'allié'}" ${selected?'checked':''}></label>`;
  const card=`<div class="pick ${side} ${id?'locked':'empty'} ${selected?'selected':''}" data-side="${side}" data-slot="${i}">${id?`<button class="champ-thumb champ-details" data-side="${side}" data-slot="${i}" aria-label="Statistiques de ${esc(name(id))}">${photo(id)}</button>`:`<div class="champ-thumb empty">${photo(null)}</div>`}<div class="pick-main"><div class="slot-top"><div class="who"><input type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="suggest-${side}-${i}" aria-expanded="false" aria-label="${right?'Adversaires':'Alliés'} ${ROLES[i]}, champion" placeholder="Chercher…" value="${id?esc(name(id)):''}" data-combo="true"></div></div>${mode!=='live'?`<button class="player-link" data-player-side="${side}" data-player-slot="${i}">${account?esc(account.game_name+'#'+account.tag_line):'＋ Joueur visible (facultatif)'}</button>`:''}<div data-stat>${statBlock(side,i)}</div></div><div class="suggest" id="suggest-${side}-${i}" role="listbox" hidden></div></div>`;
  return `<div class="slot-wrap ${side}">${right?card+toggle:toggle+card}</div>`;
}
function renderRows(){
  closeDropdown();$('teamrows').innerHTML=ROLES.map((r,i)=>`<div class="teamrow">${slotHtml('blue',i)}<div class="role"><span class="symbol">${icons[i]}</span>${r}</div>${slotHtml('red',i)}</div>`).join('');
  $('selection-summary').innerHTML=(['blue','red'] as Side[]).map(s=>draft.selected[s].length?`<span class="summary-chip ${s==='red'?'red':''}">${draft.selected[s].length} poste(s) ${s==='blue'?'allié(s)':'adverse(s)'}</span>`:'').join('');
}
function updateStats(){document.querySelectorAll<HTMLElement>('.pick').forEach(el=>{const target=el.querySelector('[data-stat]');if(target)target.innerHTML=statBlock(el.dataset.side as Side,Number(el.dataset.slot));});}
function changed(){analysis=null;updateStats();renderResults();persist();schedule();if($('ai-answer').textContent)$('ai-answer').textContent='La draft a changé. Demande un nouvel avis pour ce contexte.';}
function choose(side:Side,slot:number,id:string|null){
  if(id&&[...draft.blue,...draft.red,...draft.bans].includes(id)&&draft[side][slot]!==id)return;
  draft[side][slot]=id;draft.selected[side]=id?draft.selected[side].filter(i=>i!==slot):[...new Set([...draft.selected[side],slot])];renderRows();changed();
  if(mode==='live'){
    const next=Array.from(document.querySelectorAll<HTMLInputElement>('[data-combo]')).find(el=>!el.value);next?.focus();
  }
}
let openPick:HTMLElement|null=null,activeIndex=0;
function closeDropdown(){if(openPick){openPick.querySelector<HTMLElement>('.suggest')!.hidden=true;openPick.querySelector('input')?.setAttribute('aria-expanded','false');}openPick=null;}
function dropdown(pick:HTMLElement,q:string){
  if(openPick!==pick)closeDropdown();openPick=pick;activeIndex=0;
  const query=norm(q),current=draft[pick.dataset.side as Side][Number(pick.dataset.slot)];
  const matches=champions.filter(c=>norm(c.name).includes(query)||norm(c.id).includes(query)).sort((a,b)=>Number(norm(b.name).startsWith(query))-Number(norm(a.name).startsWith(query))||a.name.localeCompare(b.name,'fr')).slice(0,60);
  const drop=pick.querySelector<HTMLElement>('.suggest')!;
  drop.innerHTML=(current?`<button type="button" class="suggest-choice" role="option" data-champ=""><span>×</span><strong>Retirer ${esc(name(current))}</strong></button>`:'')+matches.map(c=>{
    const taken=[...draft.blue,...draft.red,...draft.bans].includes(c.id)&&c.id!==current;
    return `<button type="button" class="suggest-choice" role="option" data-champ="${c.id}" ${taken?'disabled':''}><img loading="lazy" src="${image(c.id)}" alt=""><span><strong>${esc(c.name)}</strong><small>${taken?'Déjà sélectionné ou banni':'Sélectionner'}</small></span></button>`;
  }).join('')||'<div class="suggest-none">Aucun champion trouvé</div>';
  drop.hidden=false;pick.querySelector('input')!.setAttribute('aria-expanded','true');markActive();
}
function markActive(){const choices=openPick?.querySelectorAll<HTMLButtonElement>('[data-champ]:not(:disabled)');choices?.forEach((b,i)=>{b.classList.toggle('active',i===activeIndex);b.setAttribute('aria-selected',String(i===activeIndex));if(i===activeIndex)b.scrollIntoView({block:'nearest'});});}
$('teamrows').addEventListener('focusin',e=>{const input=e.target as HTMLInputElement;if(input.matches('[data-combo]')){input.select();dropdown(input.closest('.pick')!,'');}});
$('teamrows').addEventListener('input',e=>{const input=e.target as HTMLInputElement;if(input.matches('[data-combo]'))dropdown(input.closest('.pick')!,input.value);});
$('teamrows').addEventListener('pointerdown',e=>{if((e.target as HTMLElement).closest('[data-champ]'))e.preventDefault();});
$('teamrows').addEventListener('keydown',e=>{
  if(!(e.target as HTMLElement).matches('[data-combo]'))return;
  const opts=openPick?.querySelectorAll<HTMLButtonElement>('[data-champ]:not(:disabled)');
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();activeIndex=Math.max(0,Math.min((opts?.length||1)-1,activeIndex+(e.key==='ArrowDown'?1:-1)));markActive();}
  if(e.key==='Enter'){e.preventDefault();opts?.[activeIndex]?.click();}if(e.key==='Escape')closeDropdown();
});
$('teamrows').addEventListener('focusout',e=>{const input=e.target as HTMLInputElement;if(input.matches('[data-combo]'))setTimeout(()=>{if(!input.closest('.pick')?.contains(document.activeElement)){const p=input.closest<HTMLElement>('.pick')!;const id=draft[p.dataset.side as Side][Number(p.dataset.slot)];input.value=id?name(id):'';if(openPick===p)closeDropdown();}},150);});
$('teamrows').addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.matches('.slot-analyze')){const side=input.dataset.side as Side,slot=Number(input.dataset.slot);draft.selected[side]=input.checked?[...new Set([...draft.selected[side],slot])]:draft.selected[side].filter(i=>i!==slot);renderRows();changed();}});
$('teamrows').addEventListener('click',e=>{
  const el=e.target as HTMLElement,choice=el.closest<HTMLButtonElement>('[data-champ]');
  if(choice){const pick=choice.closest<HTMLElement>('.pick')!;choose(pick.dataset.side as Side,Number(pick.dataset.slot),choice.dataset.champ||null);return;}
  const detail=el.closest<HTMLElement>('.champ-details');if(detail){openDetail(detail.dataset.side as Side,Number(detail.dataset.slot));return;}
  const player=el.closest<HTMLElement>('[data-player-side]');if(player)selectPlayer(player.dataset.playerSide as Side,Number(player.dataset.playerSlot));
});
document.addEventListener('click',e=>{if(openPick&&!openPick.contains(e.target as Node))closeDropdown();if(!(e.target as HTMLElement).closest('.config-wrap')){$('config-panel').hidden=true;$('config-btn').setAttribute('aria-expanded','false');}});
document.addEventListener('error',e=>{if(e.target instanceof HTMLImageElement)e.target.hidden=true;},true);

function collectiveHtml(c:any,label='WR du groupe allié'){
  const s=c?.allies;return `<div class="combo-collective"><div><div class="combo-collective-label">${label}</div><div class="combo-collective-sub">Observé · ${format(s?.n||0,0)} matchs · fiabilité ${s?.reliability||'absente'}<br>IC 95 % : ${interval(s)}</div></div><strong class="combo-collective-value ${s?.n?'':'missing'}">${s?.n?format(s.wr)+' %':'Indisponible'}<small>${s?.n?'fréquence historique':'échantillon insuffisant'}</small></strong></div>`;
}
function renderResults(){
  if(!analysis){$('analysis-results').innerHTML='';$('applied-overview').innerHTML='';return;}
  const context=analysis.context;
  $('data-status').textContent=`${context.games.toLocaleString('fr-FR')} matchs collectés · ${context.source} · ${context.patch==='all'?'tous patchs':context.patch} · ${context.platform==='all'?'régions collectées':context.platform} · ${context.days} jours.${context.newest?' Dernier match collecté : '+new Date(context.newest).toLocaleDateString('fr-FR'):''} Échantillon non représentatif ; le classement ne prédit pas une probabilité de victoire.`;
  $('applied-overview').innerHTML=(['blue','red'] as Side[]).filter(s=>draft[s].some(Boolean)).map(s=>`<div class="collective-preview ${s==='red'?'red':''}"><div class="collective-preview-copy"><span class="collective-preview-label">${s==='blue'?'Alliés':'Adversaires'} · ${draft[s].filter(Boolean).length} champion(s)</span><span class="collective-preview-note">WR observé dans le corpus collecté : ${value(analysis.collective[s].allies,'wr')} · ${analysis.collective[s].allies.n} matchs. Face aux champions opposés : ${value(analysis.collective[s].against,'wr')} (${analysis.collective[s].against.n} matchs). ${analysis.collective[s].probability===null?'Probabilité prédite indisponible.':'Probabilité estimée par modèle calibré : '+format(100*analysis.collective[s].probability)+' %.'}</span></div></div>`).join('');
  $('analysis-results').innerHTML=(['blue','red'] as Side[]).filter(s=>draft.selected[s].length).map(side=>{
    const combos=analysis.recommendations[side],slots=draft.selected[side];
    if(!combos.length)return `<div class="no-data"><strong>${side==='blue'?'Alliés':'Adversaires'} · ${slots.map(i=>ROLES[i]).join(' + ')}</strong><br>Pas encore assez de parties par poste pour classer les compositions dans ce contexte. Complète la draft ou élargis les filtres. La collecte continue en arrière-plan.</div>`;
    return `<section class="result-block ${side==='red'?'red':''}"><div class="result-heading"><div><div class="result-kicker">${side==='blue'?'🐵 CÔTÉ ALLIÉ':'CÔTÉ ADVERSE'}</div><h3>${slots.length===1?'Choix':slots.length===2?'Duos':'Compositions'} suggérés</h3><p>${slots.map(i=>ROLES[i]).join(' + ')} · avec les champions déjà fixés</p></div><span class="result-warning">Classement statistique · recherche approchée</span></div><div class="result-cards">${combos.map((c:any,i:number)=>`<article class="combo ${i===0?'best':''}"><div class="combo-top"><span class="combo-rank">${i===0?'★ Suggestion principale':'ALTERNATIVE '+(i+1)}</span></div>${collectiveHtml(c.collective)}${c.collective.probability!==null?`<p class="inline-note">Estimation du modèle calibré : ${format(c.collective.probability*100)} % de victoire contre l’équipe adverse complète.</p>`:''}<div class="combo-picks">${Object.entries(c.parts).map(([slot,id])=>`<div class="combo-pick"><img src="${image(id as string)}" alt=""><div class="combo-champ"><strong>${esc(name(id as string))}</strong><span>${ROLES[+slot]} · ${value(c.stats.find((s:any)=>s.slot===+slot)?.stat,'wr')} au poste</span></div></div>`).join('')}</div><p class="combo-reason">${esc(c.explanation)} Le groupe face aux adversaires : ${value(c.collective.against,'wr')} · ${c.collective.against.n} matchs.</p><button class="combo-apply" data-apply-side="${side}" data-apply-index="${i}">Appliquer</button></article>`).join('')}</div><p class="result-note">Les taux collectifs incluent tous les champions fixés et proposés, à leurs postes. Un échantillon vide n’est pas remplacé par la moyenne des winrates individuels. Les adversaires interviennent dans le classement ; le WR du groupe reste distinct du WR face à ces adversaires.</p></section>`;
  }).join('');
}
$('analysis-results').addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-apply-side]');if(!b)return;const side=b.dataset.applySide as Side,combo=analysis?.recommendations[side][Number(b.dataset.applyIndex)];if(!combo)return;for(const [i,c]of Object.entries(combo.parts))draft[side][+i]=c as string;draft.selected[side]=[];renderRows();changed();toast('Composition appliquée. Les statistiques s’actualisent.');});
function schedule(){
  clearTimeout(timer);controller?.abort();sequence++;const current=sequence;
  $('auto-status').textContent='◌ Actualisation';
  timer=setTimeout(async()=>{
    controller=new AbortController();
    try{
      const result=await api('analyze',{method:'POST',body:JSON.stringify(draft),signal:controller.signal});
      if(current!==sequence)return;analysis=result;updateStats();renderResults();$('auto-status').textContent='● À jour';
    }catch(e){if(current!==sequence||(e as Error).name==='AbortError')return;$('auto-status').textContent='○ Hors ligne';$('data-status').textContent=(e as Error).message;}
  },300);
}
function openDetail(side:Side,slot:number){
  const id=draft[side][slot];if(!id)return;
  const c=analysis?.cards?.[side]?.[slot];$('champ-detail-title').textContent=name(id);
  $('champ-dialog-body').innerHTML=`<div class="dialog-identity"><img src="${image(id)}" alt=""><div><strong>${ROLES[slot]} · ${side==='blue'?'Allié':'Adversaire'}</strong><p>Source : Riot Match-V5 / Timeline · ${esc(draft.filter.patch)} · ${draft.filter.days} jours</p></div></div><p class="observed-badge">Fréquences observées · IC 95 % de Wilson · aucun taux simulé</p><div class="dialog-stat-grid">${[['Tous postes · corpus collecté',c?.global,'wr'],['Winrate au poste',c?.role,'wr'],['Duel au même poste',c?.matchup,'wr'],...Object.keys(metrics).filter(k=>!['wr','vs'].includes(k)).map(k=>[metrics[k],c?.role,k])].map(([label,stat,k])=>`<div class="dialog-stat"><strong>${value(stat,k as string)}</strong><span>${label}<br>n=${(stat as any)?.n||0}${['gold15','gd15','xp15','xpd15'].includes(k as string)?' · timelines='+((stat as any)?.timelineN||0):''}</span></div>`).join('')}</div><p class="dialog-note">Au poste : ${c?.role?.n||0} parties, fiabilité ${c?.role?.reliability||'absente'}, IC 95 % ${interval(c?.role)}. Duel : ${c?.matchup?.n||0} parties, IC 95 % ${interval(c?.matchup)}. Une fréquence sur quelques matchs est très incertaine.</p><div class="dialog-personal">Joueur associé : ${value(c?.personal.champion,'wr')} avec ce champion · ${c?.personal.champion?.n||0} parties au poste. Duel personnel : ${value(c?.personal.matchup,'wr')} · ${c?.personal.matchup?.n||0} parties.</div><div class="dialog-cross"><h4>Face aux champions adverses</h4><table><thead><tr><th>Champion</th><th>WR observé</th><th>Matchs</th><th>IC 95 %</th></tr></thead><tbody>${(c?.cross||[]).map((x:any)=>`<tr><td>${esc(name(x.champion))} · ${x.role}</td><td>${value(x.stat,'wr')}</td><td>${x.stat.n}</td><td>${interval(x.stat)}</td></tr>`).join('')}</tbody></table></div><p class="dialog-note">${esc(analysis?.context.sampling||'Aucun échantillon disponible.')} Le pickrate utilise les matchs comme dénominateur. Le KDA agrège kills et assists divisés par les morts. Les objectifs sont les participations aux tours, dragons et barons. Les moyennes à 15 min utilisent uniquement les timelines disponibles.</p>`;
  $<HTMLDialogElement>('champ-dialog').showModal();
}
function renderMetricOptions(){
  $('metric-menu').innerHTML=Object.entries(metrics).map(([k,label])=>`<label><input type="checkbox" value="${k}" ${shown.includes(k)?'checked':''}>${label}</label>`).join('');
  $('metric-menu').onchange=()=>{const selected=Array.from($('metric-menu').querySelectorAll<HTMLInputElement>('input:checked')).map(i=>i.value);if(!selected.length){renderMetricOptions();return;}shown=selected;updateStats();savePreferences();};
}
function syncFilters(){
  for(const [k,v]of Object.entries(draft.filter)){
    const select=$<HTMLSelectElement>(`filter-${k}`);if(!Array.from(select.options).some(o=>o.value===String(v)))select.add(new Option(String(v),String(v)));select.value=String(v);
  }
  $('filter-summary').textContent=`${draft.filter.patch==='all'?'Tous patchs':draft.filter.patch} · ${draft.filter.platform==='all'?'Régions collectées':draft.filter.platform} · ${draft.filter.days} j`;
}
document.querySelectorAll<HTMLSelectElement>('.filter-grid select').forEach(s=>s.onchange=()=>{
  draft.filter={patch:$<HTMLSelectElement>('filter-patch').value,platform:$<HTMLSelectElement>('filter-platform').value,queue:Number($<HTMLSelectElement>('filter-queue').value),days:Number($<HTMLSelectElement>('filter-days').value),tier:$<HTMLSelectElement>('filter-tier').value};syncFilters();changed();savePreferences();
});
function renderBans(){$('ban-chips').innerHTML=draft.bans.map(id=>`<button class="ban-chip" data-ban="${id}">${esc(name(id))} ×</button>`).join('');}
$('add-ban').onclick=()=>{const input=$<HTMLInputElement>('ban-input'),c=champions.find(c=>norm(c.name)===norm(input.value)||norm(c.id)===norm(input.value));if(!c){toast('Choisis un champion du catalogue.');return;}if(draft.bans.length>=10||[...draft.blue,...draft.red,...draft.bans].includes(c.id)){toast('Champion déjà choisi ou dix bans atteints.');return;}draft.bans.push(c.id);input.value='';renderBans();changed();};
$('ban-chips').onclick=e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-ban]');if(b){draft.bans=draft.bans.filter(c=>c!==b.dataset.ban);renderBans();changed();}};

async function loadProfile(){const profile=await api('profile',{},true);accounts=profile.accounts;const p=profile.preferences;if(p.metrics)shown=p.metrics;if(typeof p.global==='boolean')globalOn=p.global;if(typeof p.personal==='boolean')personalOn=p.personal;if(p.filter)draft.filter=p.filter;if(!p.primaryAccountId||!accounts.some(a=>a.id===p.primaryAccountId)){personalOn=false;myAccountId='';}if(p.primaryAccountId&&accounts.some(a=>a.id===p.primaryAccountId)){myAccountId=p.primaryAccountId;myRole=p.myRole??1;if(personalOn)associateMe();}$<HTMLInputElement>('stat-global').checked=globalOn;$<HTMLInputElement>('stat-mine').checked=personalOn;renderMetricOptions();syncFilters();renderRows();schedule();}
async function showAccount(){
  $<HTMLDialogElement>('account-dialog').showModal();
  if(!user){$('account-content').innerHTML='<p class="inline-note">Connecte-toi pour conserver tes comptes Riot, tes préférences et tes drafts.</p><button id="google-login" class="mainbtn">Continuer avec Google</button><p class="inline-note">La connexion Google est gérée par Neon Auth. L’association d’un Riot ID reste une déclaration, distincte d’une autorisation Riot Sign On.</p>';
    $('google-login').onclick=async()=>{const button=$<HTMLButtonElement>('google-login');button.disabled=true;button.textContent='Connexion à Google…';try{await authReady;if(user){await showAccountRefresh();return;}if(!auth)throw new Error('Authentification indisponible. Réessaie dans un instant.');const result=await auth.signIn.social({provider:'google',callbackURL:location.origin});if(result.error)throw new Error(result.error.message||'Connexion indisponible.');}catch(e){toast((e as Error).message);button.disabled=false;button.textContent='Continuer avec Google';}};return;
  }
  $('account-content').innerHTML='<p class="inline-note">Chargement de ton espace…</p>';
  try{
    await loadProfile();const history=await api('drafts',{},true);
    $('account-content').innerHTML=`<p class="inline-note">${esc(user.name)} · Ton espace privé</p><button id="logout" class="smallbtn">Se déconnecter</button><h4 class="account-heading">Comptes Riot</h4><p class="inline-note">Associe ton compte ou un joueur dont l’identité est publiquement visible. Cette déclaration ne prouve pas que tu possèdes le compte. Aucun joueur masqué ne peut être recherché via la draft en direct.</p>${accounts.map(a=>`<div class="account-item"><div><strong>${esc(a.game_name+'#'+a.tag_line)}</strong><small>${a.platform} · ID déclaré, RSO non autorisé</small><small>${a.rank_data?.length?a.rank_data.map((r:any)=>esc(r.tier+' '+r.rank+' · '+r.leaguePoints+' LP')).join(' / '):'Rang en attente'} · ${a.refreshed_at?'Actualisé le '+new Date(a.refreshed_at).toLocaleDateString('fr-FR'):'Collecte en attente'}</small></div><div class="account-actions"><button class="smallbtn" data-account-stats="${a.id}">Stats</button><button class="smallbtn" data-refresh="${a.id}">Actualiser</button><button class="minorbtn" data-remove-account="${a.id}">Retirer</button></div></div>`).join('')}<form class="account-form" id="riot-form"><label>Riot ID<input id="riot-id" placeholder="Pseudo#EUW" required maxlength="60"></label><label>Région<select id="riot-platform">${['EUW1','EUN1','NA1','KR','BR1','JP1','TR1','RU','LA1','LA2','OC1','PH2','SG2','TH2','TW2','VN2'].map(p=>`<option>${p}</option>`).join('')}</select></label><label class="checklabel"><input type="checkbox" required> Je confirme que cette identité est visible ou qu’il s’agit de mon compte. Elle n’est pas masquée par Riot.</label><button class="smallbtn">Associer le Riot ID</button></form><div id="profile-stats" class="profile-stats"></div><h4 class="account-heading">Tes drafts</h4>${history.length?history.map((d:any)=>`<div class="history-item"><div><strong>${esc(d.name)}</strong><small>${new Date(d.updated_at).toLocaleString('fr-FR')} · ${d.state.blue.filter(Boolean).length} alliés</small></div><div class="account-actions"><button class="smallbtn" data-load-draft="${d.id}">Ouvrir</button><button class="minorbtn" data-delete-draft="${d.id}">Supprimer</button></div></div>`).join(''):'<p class="inline-note">Enregistre une draft pour la retrouver ici.</p>'}<details><summary>Mes données</summary><p class="inline-note">Supprime les profils, comptes associés, préférences et drafts de Singe Drafting. Ton compte Google et la session Neon Auth sont conservés.</p><button class="minorbtn" id="delete-profile">Effacer mes données Singe Drafting</button></details>`;
    $('riot-form').onsubmit=async e=>{e.preventDefault();const button=$('riot-form').querySelector('button')!;button.disabled=true;try{await api('accounts',{method:'POST',body:JSON.stringify({riotId:$<HTMLInputElement>('riot-id').value,platform:$<HTMLSelectElement>('riot-platform').value,visibleIdentity:true})},true);toast('Compte associé. La collecte des matchs est programmée.');await showAccountRefresh();}catch(e){toast((e as Error).message);}finally{button.disabled=false;}};
    $('logout').onclick=async()=>{try{const result=await auth?.signOut();if(result?.error)throw new Error(result.error.message);user=null;accounts=[];myAccountId='';draft.players=[];personalOn=false;$('personal-banner').hidden=true;shown=['wr','vs','gd15'];globalOn=true;$<HTMLInputElement>('stat-mine').checked=false;$<HTMLInputElement>('stat-global').checked=true;$('account-btn').textContent='Se connecter';$<HTMLDialogElement>('account-dialog').close();renderMetricOptions();renderRows();changed();}catch{toast('Déconnexion indisponible. Réessaie.');}};
    $('delete-profile').onclick=async()=>{if(!confirm('Effacer tes données Singe Drafting ? Cette suppression est définitive.'))return;await api('profile',{method:'DELETE'},true);accounts=[];draft.players=[];toast('Données Singe Drafting effacées.');await showAccountRefresh();};
    $('account-content').onclick=async e=>{
      const target=e.target as HTMLElement;
      try{
        if(target.dataset.accountStats){const r=await api(`accounts/${target.dataset.accountStats}`,{},true);$('profile-stats').innerHTML=`<h4>Statistiques personnelles</h4><p>Solo/Duo · 90 jours · ${r.overall.n} parties importées · WR ${value(r.overall,'wr')} · KDA ${value(r.overall,'kda')}</p><ul>${r.champions.map((c:any)=>`<li>${esc(name(c.champion))} : ${value(c.stat,'wr')} · ${c.stat.n} parties</li>`).join('')}</ul><p class="inline-note">Historique importé progressivement, limité à l’échantillon disponible. La maîtrise n’est pas un winrate.</p>`;}
        if(target.dataset.refresh){await api(`accounts/${target.dataset.refresh}`,{method:'POST'},true);toast('Actualisation programmée. Elle respecte le débit Riot.');}
        if(target.dataset.removeAccount){await api(`accounts/${target.dataset.removeAccount}`,{method:'DELETE'},true);draft.players=draft.players?.filter(p=>p.accountId!==target.dataset.removeAccount);await showAccountRefresh();}
        if(target.dataset.loadDraft){const saved=history.find((d:any)=>d.id===target.dataset.loadDraft);draft={...saved.state,players:(saved.state.players||[]).filter((p:any)=>accounts.some(a=>a.id===p.accountId))};$<HTMLDialogElement>('account-dialog').close();syncFilters();renderBans();begin('manual');changed();}
        if(target.dataset.deleteDraft){await api(`drafts/${target.dataset.deleteDraft}`,{method:'DELETE'},true);await showAccountRefresh();}
      }catch(e){toast((e as Error).message);}
    };
  }catch(e){$('account-content').textContent=(e as Error).message;}
}
async function showAccountRefresh(){$<HTMLDialogElement>('account-dialog').close();await showAccount();}
function selectPlayer(side:Side,slot:number){
  if(!user){void showAccount();return;}
  $<HTMLDialogElement>('account-dialog').showModal();$('account-content').onclick=null;
  $('account-content').innerHTML=`<p class="inline-note">${ROLES[slot]} · ${side==='blue'?'Allié':'Adversaire'}. Utilise uniquement une identité visible. Compte déclaré, sans vérification RSO.</p><div class="account-form"><label>Compte<select id="slot-account"><option value="">Anonyme / données générales uniquement</option>${accounts.map(a=>`<option value="${a.id}">${esc(a.game_name+'#'+a.tag_line)} · ${a.platform}</option>`).join('')}</select></label><button class="smallbtn" id="apply-account">Associer au poste</button><button class="minorbtn" id="manage-accounts">Gérer mes comptes Riot</button></div>`;
  $<HTMLSelectElement>('slot-account').value=draft.players?.find(p=>p.side===side&&p.slot===slot)?.accountId||'';
  $('apply-account').onclick=()=>{draft.players=draft.players?.filter(p=>p.side!==side||p.slot!==slot)||[];const id=$<HTMLSelectElement>('slot-account').value;if(id)draft.players.push({side,slot,accountId:id});$<HTMLDialogElement>('account-dialog').close();renderRows();changed();};
  $('manage-accounts').onclick=()=>void showAccountRefresh();
}
function associateMe(){
  draft.players=(draft.players||[]).filter(p=>!(p.side==='blue'&&p.slot===myRole)&&p.accountId!==myAccountId);
  if(myAccountId)draft.players.push({side:'blue',slot:myRole,accountId:myAccountId});
}
async function updateCoverage(){
  try{const c=await api('coverage');$('coverage-banner').textContent=`Corpus Riot en constitution : ${format(c.recent,0)} matchs récents (${format(c.total,0)} au total). Ce ne sont pas les statistiques mondiales de tous les joueurs. Les taux reposant sur moins de 30 parties ne sont pas affichés sur les cartes.`;}catch{$('coverage-banner').textContent='Couverture statistique indisponible. Aucun agrégat mondial externe n’est connecté.';}
}
function showIdentitySetup(purpose:'personal'|'live'){
  const personal=purpose==='personal',account=accounts.find(a=>a.id===myAccountId)||accounts[0];
  $('identity-title').textContent=personal?'Tes statistiques LoL':'Chercher ta partie';
  $('identity-content').innerHTML=`<p class="inline-note">${personal?'Indique ton Riot ID et ton poste pour associer tes propres performances aux recommandations.':'La recherche interroge réellement Riot Spectator-V5. Elle détecte une partie commencée, pas une sélection de champions.'}</p><form class="account-form" id="identity-form"><label for="setup-riot-id">Riot ID</label><input id="setup-riot-id" placeholder="Pseudo#TAG" required maxlength="60" value="${account?esc(account.game_name+'#'+account.tag_line):''}"><label for="setup-platform">Région</label><select id="setup-platform">${['EUW1','EUN1','NA1','KR','BR1','JP1','TR1','RU','LA1','LA2','OC1','SG2','TW2','VN2'].map(p=>`<option ${p===account?.platform?'selected':''}>${p}</option>`).join('')}</select>${personal?`<label for="setup-role">Ton poste</label><select id="setup-role">${ROLES.map((r,i)=>`<option value="${i}" ${i===myRole?'selected':''}>${r}</option>`).join('')}</select><p class="inline-note">${user?'Le compte sera conservé dans ton espace privé.':'Ton Riot ID sera associé après la connexion Google pour conserver tes données dans ton espace privé.'} Une déclaration de Riot ID ne remplace pas Riot Sign On.</p>`:''}<button class="mainbtn" id="identity-submit">${personal?'Charger mes statistiques':'Rechercher une partie en cours'}</button><p id="identity-status" class="inline-note" role="status"></p></form>`;
  $<HTMLDialogElement>('identity-dialog').showModal();
  $('identity-form').onsubmit=async e=>{
    e.preventDefault();const button=$<HTMLButtonElement>('identity-submit');button.disabled=true;
    const input={riotId:$<HTMLInputElement>('setup-riot-id').value.trim(),platform:$<HTMLSelectElement>('setup-platform').value,role:personal?Number($<HTMLSelectElement>('setup-role').value):0};
    try{
      if(personal){
        await authReady;
        if(!user){sessionStorage.setItem('singe:pending-riot',JSON.stringify(input));if(!auth)throw new Error('Connexion Google indisponible. Réessaie dans un instant.');$('identity-status').textContent='Connexion Google, puis association automatique de ce Riot ID…';const result=await auth.signIn.social({provider:'google',callbackURL:location.origin});if(result.error)throw new Error(result.error.message||'Connexion Google indisponible.');return;}
        $('identity-status').textContent='Association du compte et importation des premiers matchs…';await connectPersonal(input);$<HTMLDialogElement>('identity-dialog').close();
      }else{
        $('identity-status').textContent='Recherche réelle auprès de Riot…';const result=await api('live',{method:'POST',body:JSON.stringify(input)});
        if(result.status==='not_in_game'){$('identity-status').textContent=result.message;return;}
        showLiveGame(result);
      }
    }catch(e){$('identity-status').textContent=(e as Error).message;}
    finally{button.disabled=false;}
  };
}
async function connectPersonal(input:{riotId:string;platform:string;role:number}){
  const existing=accounts.find(a=>norm(a.game_name+'#'+a.tag_line)===norm(input.riotId)&&a.platform===input.platform);
  const account=existing||await api('accounts',{method:'POST',body:JSON.stringify({...input,visibleIdentity:true})},true);
  myAccountId=account.id;myRole=input.role;personalOn=true;associateMe();
  $<HTMLInputElement>('stat-mine').checked=true;$('personal-banner').hidden=false;
  $('personal-banner').textContent=`Mes statistiques : ${input.riotId} · ${input.platform} · ${ROLES[myRole]}. Importation de l’historique en cours…`;
  await api('profile',{method:'PUT',body:JSON.stringify({metrics:shown,global:globalOn,personal:true,filter:draft.filter,primaryAccountId:myAccountId,myRole})},true);
  const profile=await api('profile',{},true);accounts=profile.accounts;renderRows();changed();
  try{const sync=await api(`accounts/${myAccountId}/sync`,{method:'POST'},true);$('personal-banner').textContent=`Mes statistiques : ${input.riotId} · ${ROLES[myRole]} · ${sync.imported} nouveaux matchs importés. Le reste de l’historique est traité en arrière-plan.`;changed();}
  catch(e){$('personal-banner').textContent=`Compte ${input.riotId} associé. ${(e as Error).message}`;}
  savePreferences();
}
function showLiveGame(result:any){
  const game=result.game;
  if(game.mapId&&game.mapId!==11){$('identity-content').innerHTML=`<p class="live-found">Partie réellement détectée : ${esc(game.mode)}</p><p class="inline-note">Cette partie ne se joue pas sur la Faille de l’invocateur. Le moteur de draft à cinq postes ne couvre pas ce mode.</p>`;return;}
  $('identity-content').innerHTML=`<p class="live-found">● Partie détectée par Riot · ${esc(result.account.riotId)}</p><p class="inline-note">Source : ${esc(game.source)} · partie ${esc(game.gameId)}. Riot ne fournit pas les postes dans cet endpoint : confirme-les avant d’utiliser les duels.</p><label class="inline-note">Ton équipe<select id="live-own-team"><option value="100" ${game.trackedTeam===100?'selected':''}>Bleue</option><option value="200" ${game.trackedTeam===200?'selected':''}>Rouge</option></select></label><form id="live-import-form"><div class="live-teams">${game.teams.map((t:any)=>`<div><h4>${t.team===100?'Équipe bleue':'Équipe rouge'}</h4>${t.champions.map((c:any,i:number)=>`<label class="live-champion"><img src="${image(c.champion)}" alt=""><span>${esc(name(c.champion))}</span><select data-live-team="${t.team}" data-live-champion="${esc(c.champion)}" required aria-label="Poste de ${esc(name(c.champion))}"><option value="">Poste…</option>${ROLES.map((r,j)=>`<option value="${j}">${r}</option>`).join('')}</select></label>`).join('')}</div>`).join('')}</div><p id="live-import-status" class="inline-note" role="status"></p><button class="mainbtn">Importer les champions et analyser</button></form>`;
  $('live-import-form').onsubmit=e=>{e.preventDefault();const blue=Array(5).fill(null),red=Array(5).fill(null),own=Number($<HTMLSelectElement>('live-own-team').value);
    for(const s of document.querySelectorAll<HTMLSelectElement>('[data-live-team]')){const team=Number(s.dataset.liveTeam)===own?blue:red,slot=Number(s.value);if(team[slot]){$('live-import-status').textContent='Choisis cinq postes différents dans chaque équipe.';return;}team[slot]=s.dataset.liveChampion;}
    if(blue.some(c=>!c)||red.some(c=>!c)){$('live-import-status').textContent='Les deux équipes doivent contenir cinq champions.';return;}
    draft.blue=blue;draft.red=red;draft.bans=game.bans.filter((c:string)=>![...blue,...red].includes(c));draft.selected={blue:[],red:[]};draft.players=[];if(personalOn&&myAccountId)associateMe();if(result.account.platform)draft.filter.platform=result.account.platform;if([420,440].includes(game.queue))draft.filter.queue=game.queue;syncFilters();$<HTMLDialogElement>('identity-dialog').close();renderBans();renderRows();changed();$('live-note').innerHTML=`Partie ${esc(game.gameId)} détectée via Riot Spectator-V5. Postes confirmés manuellement. <button class="smallbtn" id="find-live">Actualiser la recherche</button>`;$('find-live').onclick=()=>showIdentitySetup('live');
  };
}
$('close-identity').onclick=()=>{$<HTMLDialogElement>('identity-dialog').close();$<HTMLInputElement>('stat-mine').checked=personalOn;};
$('identity-dialog').addEventListener('cancel',()=>{$<HTMLInputElement>('stat-mine').checked=personalOn;});
$('find-live').onclick=()=>showIdentitySetup('live');
$('save-draft').onclick=async()=>{if(!user){void showAccount();return;}try{await api('drafts',{method:'POST',body:JSON.stringify({name:`Draft ${new Date().toLocaleString('fr-FR')}`,state:draft})},true);toast('Draft enregistrée dans ton espace.');}catch(e){toast((e as Error).message);}};
async function askAI(question:string){
  if(!user){void showAccount();return;}const buttons=$('ai-panel').querySelectorAll('button');buttons.forEach(b=>b.disabled=true);$('ai-answer').textContent='Le singe examine les données disponibles…';const fingerprint=JSON.stringify(draft);
  try{const result=await api('ask',{method:'POST',body:JSON.stringify({draft,question})},true);$('ai-answer').textContent=fingerprint===JSON.stringify(draft)?result.answer:'La draft a changé pendant l’analyse. Demande un nouvel avis.';}catch(e){$('ai-answer').textContent=(e as Error).message;}finally{buttons.forEach(b=>b.disabled=false);}
}
$('ai-analyze').onclick=()=>void askAI('Donne un avis court sur les forces, faiblesses et incertitudes de cette draft.');
$('ai-form').onsubmit=e=>{e.preventDefault();const input=$<HTMLInputElement>('ai-question');if(input.value.trim())void askAI(input.value.trim());};
$('begin-live').onclick=()=>begin('live');$('begin-manual').onclick=()=>begin('manual');$('brand').onclick=$('back').onclick=()=>page('home');
$('account-btn').onclick=()=>void showAccount();$('close-account').onclick=()=>$<HTMLDialogElement>('account-dialog').close();$('close-champ').onclick=()=>$<HTMLDialogElement>('champ-dialog').close();
for(const id of ['account-dialog','champ-dialog'])$(id).addEventListener('click',e=>{if(e.target===$(id))$<HTMLDialogElement>(id).close();});
$('clear-draft').onclick=()=>{draft.blue=Array(5).fill(null);draft.red=Array(5).fill(null);draft.selected={blue:[0,1,2,3,4],red:[0,1,2,3,4]};renderRows();changed();};
$('fill-example').onclick=()=>{draft.blue=['Darius','Fiddlesticks','Ahri',null,null];draft.red=['Garen','Viego','Yasuo','Caitlyn','Nautilus'];draft.selected={blue:[3,4],red:[]};draft.bans=[];renderBans();renderRows();changed();toast('Exemple de sélections uniquement. Les statistiques viennent des matchs collectés.');};
$('stat-global').onchange=()=>{globalOn=$<HTMLInputElement>('stat-global').checked;updateStats();savePreferences();};$('stat-mine').onchange=async()=>{if($<HTMLInputElement>('stat-mine').checked){await authReady;showIdentitySetup('personal');}else{personalOn=false;$('personal-banner').hidden=true;updateStats();savePreferences();}};
$('config-btn').onclick=()=>{const p=$('config-panel');p.hidden=!p.hidden;$('config-btn').setAttribute('aria-expanded',String(!p.hidden));};
async function init(){
  authReady=initializeAuth();
  try{const saved=JSON.parse(localStorage.getItem('singe:draft:v1')||'null');if(saved?.blue?.length===5&&saved?.red?.length===5&&saved.filter&&saved.selected){draft={...saved,players:[]};}}catch{}
  syncFilters();renderRows();renderBans();renderMetricOptions();
  const cat=await fetch('/data/catalog.json').then(r=>r.ok?r.json():null).catch(()=>null);if(cat?.champions){champions=cat.champions;$('champion-list').innerHTML=champions.map(c=>`<option value="${esc(c.name)}">`).join('');renderRows();}
  await authReady;
  try{const pending=JSON.parse(sessionStorage.getItem('singe:pending-riot')||'null');if(pending&&user){sessionStorage.removeItem('singe:pending-riot');begin('manual');await connectPersonal(pending);}}catch(e){toast((e as Error).message);}
  void updateCoverage();
  try{const metadata=await api('metadata');for(const p of metadata.patches){if(!Array.from($<HTMLSelectElement>('filter-patch').options).some(o=>o.value===p.patch))$<HTMLSelectElement>('filter-patch').add(new Option(`${p.patch} · ${p.games} matchs`,p.patch));}}catch{}
  if(location.search.includes('error='))toast('La connexion Google n’a pas abouti. Réessaie depuis ton espace.');
  schedule();
}
async function initializeAuth(){
  try{const config=await api('config');if(config.authUrl){auth=makeAuth(config.authUrl);const session=await auth.getSession();if(session.error)throw new Error(session.error.message||'Session indisponible.');if(session.data?.user){user=session.data.user as {id:string;name:string};$('account-btn').textContent=user.name||'Mon espace';await loadProfile();}}}catch{ /* Anonymous drafting remains available. */ }
}
void init();
setInterval(()=>{if(!document.hidden&&$('page-draft').classList.contains('on')&&!openPick)schedule();},180000);
