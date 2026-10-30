import './mockup.css';
import './extra.css';
import { sessionToken } from './session.ts';
import { attachPlayerSearch,rememberPlayer,type PlayerIdentity } from './player-search.ts';
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
let myPublicIdentity:PlayerIdentity|null=null,refreshingPublic=false,publicRetryAt=0;
let tokenPending:Promise<string|null>|null=null;
let globalOn=true,personalOn=false,shown=['wr','vs','n'];
let draft:Draft={blue:Array(5).fill(null),red:Array(5).fill(null),selected:{blue:[0,1,2,3,4],red:[0,1,2,3,4]},bans:[],players:[],filter:{patch:'all',platform:'all',queue:420,days:30,tier:'all'}};
let sequence=0,timer:ReturnType<typeof setTimeout>,controller:AbortController|null=null,preferenceTimer:ReturnType<typeof setTimeout>;
const metrics:Record<string,string>={wr:'Winrate au poste',vs:'Winrate du duel',gd15:'Δ or à 15 min',gold15:'Or à 15 min',kda:'KDA',cs:'CS / min',xp15:'XP à 15 min',xpd15:'Δ XP à 15 min',dpm:'Dégâts / min',pick:'Pickrate',ban:'Banrate',n:'Parties',kp:'Participation aux kills',vision:'Vision',objectives:'Objectifs'};
const icons=['♜','✣','✦','➶','✚'];
const name=(id:string)=>champions.find(c=>c.id===id)?.name||id;
const image=(id:string)=>`/assets/champions/${encodeURIComponent(id)}.png`;
const photo=(id:string|null)=>id?`<span>${esc(name(id).slice(0,2))}</span><img loading="lazy" src="${image(id)}" alt="">`:'<span>+</span>';
const format=(n:number|null|undefined,digits=1)=>n===null||n===undefined||!Number.isFinite(n)?'—':n.toLocaleString('fr-FR',{maximumFractionDigits:digits,minimumFractionDigits:digits});
function value(s:any,k:string){
  if(!s)return '—';const v=s[k];if(v===null||v===undefined)return '—';
  if(k==='wr'&&s.wins===null)return '≈ '+format(v,0)+' %';
  if(['wr','pick','ban','kp'].includes(k))return format(v)+' %';
  if(['n','gold15','xp15','gd15','xpd15','dpm'].includes(k))return (['gd15','xpd15'].includes(k)&&v>0?'+':'')+format(v,0);
  return format(v);
}
const interval=(s:any)=>s?.interval?`${format(s.interval[0])}–${format(s.interval[1])} %`:'indisponible';
function toast(message:string){$('toast').textContent=message;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,5000);}
async function api(path:string,options:RequestInit={},privateRequest=false){
 const headers=new Headers(options.headers);if(options.body)headers.set('content-type','application/json');
 const obtain=async(refresh=false)=>{if(!auth)return null;if(!tokenPending)tokenPending=sessionToken(auth,refresh).finally(()=>tokenPending=null);return tokenPending;};
 if(privateRequest){if(!user||!auth)throw new Error('Connecte-toi avec Google pour conserver tes données dans ton espace.');const token=await obtain();if(token)headers.set('authorization','Bearer '+token);else throw new Error('La session Google n’est plus disponible. Les profils OP.GG restent consultables sans connexion.');}
 let res=await fetch(`/api/${path}`,{...options,headers});
 if(privateRequest&&res.status===401){const token=await obtain(true);if(token){headers.set('authorization','Bearer '+token);res=await fetch(`/api/${path}`,{...options,headers});}}
 const data=await res.json().catch(()=>({error:'Service indisponible.'}));
 if(privateRequest&&res.status===401){user=null;accounts=[];draft.players=[];$('account-btn').textContent='Se connecter';}
 if(!res.ok)throw new Error(data.error||'Service indisponible.');return data;
}
function wirePlayerSearch(inputId:string,regionId:string,onChoose:()=>void){attachPlayerSearch($<HTMLInputElement>(inputId),$<HTMLSelectElement>(regionId),()=>accounts.map(a=>({riotId:a.game_name+'#'+a.tag_line,platform:a.platform})),(q,platform,signal)=>api('players/suggest?'+new URLSearchParams({q,platform}),{signal}),()=>onChoose());}
function page(which:string){document.querySelectorAll('.page').forEach(p=>p.classList.toggle('on',p.id===`page-${which}`));$('back').hidden=which==='home';window.scrollTo({top:0,behavior:'instant'});}
function begin(nextMode:string){mode=nextMode;page('draft');$('live-note').hidden=mode!=='live';$('draft-mode').textContent=mode==='live'?'DRAFT EN DIRECT · SAISIE RAPIDE':'DRAFT MANUELLE';if(mode==='live'){draft.players=[];draft.publicPlayers=[];}renderRows();schedule();if(mode==='live')showLiveLimit();}
function persist(){
  try{localStorage.setItem('singe:draft:v1',JSON.stringify({...draft,players:[]}));}catch{}
}
function savePreferences(){
  if(!user)return;clearTimeout(preferenceTimer);preferenceTimer=setTimeout(()=>api('profile',{method:'PUT',body:JSON.stringify({metrics:shown,global:globalOn,personal:personalOn,filter:draft.filter,...(myAccountId?{primaryAccountId:myAccountId,myRole}:{})})},true).catch(()=>{/* Optional account sync never interrupts public profile lookup. */}),800);
}
function statBlock(side:Side,slot:number){
  if(!draft[side][slot]||(!globalOn&&!personalOn))return '';
  const card=analysis?.cards?.[side]?.[slot];
  const associated=draft.players?.some(p=>p.side===side&&p.slot===slot)||draft.publicPlayers?.some(p=>p.side===side&&p.slot===slot);
  const sources=[...(globalOn?[{s:card?.role,title:'OP.GG · ALL TIERS',personal:false}]:[]),...(personalOn&&associated?[{s:card?.personal.champion,title:'JOUEUR · TOUS POSTES',personal:true}]:[])];
  return `<div class="two-src">${sources.map(({s,title,personal})=>`<div class="line-src"><div class="line-heading"><span class="src-label ${personal?'mine':''}">${title}</span><span class="src-n">${s?.n==null?'Volume non fourni':format(s.n,0)+' matchs'}</span></div><div class="metrics">${shown.map(k=>{
    const st=k==='vs'?(personal?card?.personal.matchup:card?.matchup):s;
    const insufficient=!personal&&st?.n!=null&&st.n<30;
    return `<span class="metric" title="${esc(metrics[k])} · n=${st?.n??'non fourni'} · IC 95 % ${interval(st)}${insufficient?' · échantillon insuffisant':''}"><strong>${insufficient?'—':value(st,k==='vs'?'wr':k)}</strong><small>${insufficient?'Échantillon < 30':esc(personal&&k==='wr'?'WR avec ce champion':metrics[k])}</small></span>`;
  }).join('')}</div></div>`).join('')}</div>`;
}
function slotHtml(side:Side,i:number){
  const id=draft[side][i],right=side==='red',selected=draft.selected[side].includes(i),player=draft.players?.find(p=>p.side===side&&p.slot===i),account=accounts.find(a=>a.id===player?.accountId),publicPlayer=draft.publicPlayers?.find(p=>p.side===side&&p.slot===i);
  const toggle=id?'<span class="edge-spacer"></span>':`<label class="edge-check"><input class="slot-analyze" type="checkbox" data-side="${side}" data-slot="${i}" aria-label="Optimiser ${ROLES[i]} ${right?'adverse':'allié'}" ${selected?'checked':''}></label>`;
  const card=`<div class="pick ${side} ${id?'locked':'empty'} ${selected?'selected':''}" data-side="${side}" data-slot="${i}">${id?`<button class="champ-thumb champ-details" data-side="${side}" data-slot="${i}" aria-label="Statistiques de ${esc(name(id))}">${photo(id)}</button>`:`<div class="champ-thumb empty">${photo(null)}</div>`}<div class="pick-main"><div class="slot-top"><div class="who"><input type="text" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="suggest-${side}-${i}" aria-expanded="false" aria-label="${right?'Adversaires':'Alliés'} ${ROLES[i]}, champion" placeholder="Chercher…" value="${id?esc(name(id)):''}" data-combo="true"></div></div>${mode!=='live'?`<button class="player-link" data-player-side="${side}" data-player-slot="${i}">${publicPlayer?esc(publicPlayer.riotId):account?esc(account.game_name+'#'+account.tag_line):'＋ Joueur visible (facultatif)'}</button>`:''}<div data-stat>${statBlock(side,i)}</div></div><div class="suggest" id="suggest-${side}-${i}" role="listbox" hidden></div></div>`;
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
 const st=c?.allies,available=st?.wr!=null;return `<div class="combo-collective"><div><div class="combo-collective-label">${label}</div><div class="combo-collective-sub">${available?'Observé OP.GG · '+format(st.n,0)+' matchs · fiabilité '+st.reliability:'Composition complète non fournie par OP.GG'}<br>IC 95 % : ${interval(st)}</div></div><strong class="combo-collective-value ${available?'':'missing'}">${available?format(st.wr)+' %':'Indisponible'}<small>${available?'fréquence historique':'aucun taux inventé'}</small></strong></div>`;
}
function renderResults(){
  if(!analysis){$('analysis-results').innerHTML='';$('applied-overview').innerHTML='';return;}
  const context=analysis.context;
  $('data-status').textContent=`OP.GG MCP · All Tiers · région non précisée par le fournisseur · patch ${context.patch||'non précisé'} · ${context.coveredChampions}/${context.totalChampions} champions actualisés.${context.upstreamUpdatedAt?' Données fournisseur : '+new Date(context.upstreamUpdatedAt).toLocaleString('fr-FR')+'.':''}${context.stale?' Dernier agrégat conservé : actualisation OP.GG en attente.':''} Le classement n’est pas une probabilité de victoire.`;
  $('applied-overview').innerHTML=(['blue','red'] as Side[]).filter(side=>draft[side].some(Boolean)).map(side=>`<div class="collective-preview ${side==='red'?'red':''}"><div class="collective-preview-copy"><span class="collective-preview-label">${side==='blue'?'Alliés':'Adversaires'} · ${draft[side].filter(Boolean).length} champion(s)</span><span class="collective-preview-note">${analysis.collective[side].allies.wr!=null?'WR observé du groupe : '+value(analysis.collective[side].allies,'wr')+' · '+format(analysis.collective[side].allies.n,0)+' matchs.':'Winrate de cette composition non fourni par OP.GG.'} Probabilité prédite indisponible.</span></div></div>`).join('');
  $('analysis-results').innerHTML=(['blue','red'] as Side[]).filter(s=>draft.selected[s].length).map(side=>{
    const combos=analysis.recommendations[side],slots=draft.selected[side];
    if(!combos.length)return `<div class="no-data"><strong>${side==='blue'?'Alliés':'Adversaires'} · ${slots.map(i=>ROLES[i]).join(' + ')}</strong><br>Pas encore assez de parties par poste pour classer les compositions dans ce contexte. Les agrégats OP.GG sont actualisés automatiquement. Les données absentes ne sont pas remplacées par l’ancien corpus Riot.</div>`;
    return `<section class="result-block ${side==='red'?'red':''}"><div class="result-heading"><div><div class="result-kicker">${side==='blue'?'🐵 CÔTÉ ALLIÉ':'CÔTÉ ADVERSE'}</div><h3>${slots.length===1?'Choix':slots.length===2?'Duos':'Compositions'} suggérés</h3><p>${slots.map(i=>ROLES[i]).join(' + ')} · avec les champions déjà fixés</p></div><span class="result-warning">Classement statistique · recherche approchée</span></div><div class="result-cards">${combos.map((c:any,i:number)=>`<article class="combo ${i===0?'best':''}"><div class="combo-top"><span class="combo-rank">${i===0?'★ Suggestion principale':'ALTERNATIVE '+(i+1)}</span></div>${collectiveHtml(c.collective)}${slots.length===2?`<p class="inline-note">Duo proposé uniquement : ${value(c.proposedGroup,'wr')} · ${c.proposedGroup?.n==null?'échantillon non fourni':format(c.proposedGroup.n,0)+' matchs observés'}. Les alliés déjà fixés ne font pas partie de cet échantillon.</p>`:''}${c.collective.probability!==null?`<p class="inline-note">Estimation du modèle calibré : ${format(c.collective.probability*100)} % de victoire contre l’équipe adverse complète.</p>`:''}<div class="combo-picks">${Object.entries(c.parts).map(([slot,id])=>`<div class="combo-pick"><img src="${image(id as string)}" alt=""><div class="combo-champ"><strong>${esc(name(id as string))}</strong><span>${ROLES[+slot]} · ${value(c.stats.find((s:any)=>s.slot===+slot)?.stat,'wr')} au poste</span></div></div>`).join('')}</div><p class="combo-reason">${esc(c.explanation)} Le taux du groupe face à l’équipe adverse complète n’est pas fourni.</p><button class="combo-apply" data-apply-side="${side}" data-apply-index="${i}">Appliquer</button></article>`).join('')}</div><p class="result-note">Les duos observés alimentent le classement quand ils sont disponibles. OP.GG MCP ne fournit pas de taux de trios ou de compositions complètes : aucun taux collectif n’est déduit d’une moyenne. Recherche approchée : 24 candidats par poste, faisceau de 64.</p></section>`;
  }).join('');
}
$('analysis-results').addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-apply-side]');if(!b)return;const side=b.dataset.applySide as Side,combo=analysis?.recommendations[side][Number(b.dataset.applyIndex)];if(!combo)return;for(const [i,c]of Object.entries(combo.parts))draft[side][+i]=c as string;draft.selected[side]=[];renderRows();changed();toast('Composition appliquée. Les statistiques s’actualisent.');});
function schedule(){
  clearTimeout(timer);controller?.abort();sequence++;const current=sequence;
  $('auto-status').textContent='◌ Actualisation';
  timer=setTimeout(async()=>{
    controller=new AbortController();
    try{
      const result=await api('analyze',{method:'POST',body:JSON.stringify(draft),signal:controller.signal},!!draft.players?.length);
      if(current!==sequence)return;analysis=result;updateStats();renderResults();$('auto-status').textContent='● À jour';if(result.missingPublicProfiles?.length)void refreshPublicPlayers();
    }catch(e){if(current!==sequence||(e as Error).name==='AbortError')return;$('auto-status').textContent='○ Hors ligne';$('data-status').textContent=(e as Error).message;}
  },300);
}
function openDetail(side:Side,slot:number){
 const id=draft[side][slot];if(!id)return;const c=analysis?.cards?.[side]?.[slot];$('champ-detail-title').textContent=name(id);
 const rows=[['Tous postes',c?.global,'wr'],['Winrate au poste',c?.role,'wr'],['Duel au même poste',c?.matchup,'wr'],...['kda','pick','ban','n'].map(k=>[metrics[k],c?.role,k])];
 $('champ-dialog-body').innerHTML=`<div class="dialog-identity"><img src="${image(id)}" alt=""><div><strong>${ROLES[slot]} · ${side==='blue'?'Allié':'Adversaire'}</strong><p>Source : <a href="https://op.gg/lol/champions" target="_blank" rel="noopener">OP.GG MCP</a> · All Tiers · région non précisée · patch ${esc(analysis?.context.patch||'non précisé')}</p></div></div><p class="observed-badge">Fréquences observées · aucun taux simulé</p><div class="dialog-stat-grid">${rows.map(([label,st,k])=>`<div class="dialog-stat"><strong>${value(st,k as string)}</strong><span>${label}<br>n=${(st as any)?.n??'non fourni'}</span></div>`).join('')}</div><p class="dialog-note">Au poste : fiabilité de volume ${c?.role?.reliability||'absente'} · IC 95 % ${interval(c?.role)}. Un intervalle est calculé seulement si OP.GG fournit les nombres exacts de victoires et de parties ; un taux arrondi n’est pas converti en victoires fictives.</p><div class="dialog-personal">Joueur associé : ${value(c?.personal.champion,'wr')} · ${format(c?.personal.champion?.n,0)} parties avec ce champion, tous postes. ${c?.personal.context?'Saison OP.GG '+esc(c.personal.context.season)+' · '+esc(c.personal.context.gameType)+'.':''} Les duels personnels et la ventilation par poste ne sont pas fournis.</div><div class="dialog-cross"><h4>Duos alliés observés</h4>${(analysis?.collective?.[side]?.duos||[]).filter((d:any)=>d.parts.some((p:any)=>p.champion===id)).map((d:any)=>`<p>${d.parts.map((p:any)=>esc(name(p.champion))).join(' + ')} : ${value(d.stat,'wr')} · ${format(d.stat.n,0)} matchs · IC 95 % ${interval(d.stat)}</p>`).join('')||'<p>Ce duo n’est pas fourni par OP.GG dans le contexte disponible.</p>'}<h4>Matchups disponibles</h4><table><thead><tr><th>Champion</th><th>WR observé</th><th>Matchs</th><th>IC 95 %</th></tr></thead><tbody>${(c?.cross||[]).map((x:any)=>`<tr><td>${esc(name(x.champion))} · ${x.role}</td><td>${value(x.stat,'wr')}</td><td>${x.stat.n??'Non fourni'}</td><td>${interval(x.stat)}</td></tr>`).join('')}</tbody></table></div><p class="dialog-note">${esc(analysis?.context.sampling||'Aucun agrégat disponible.')} Les mesures à 15 minutes, timelines, trios, compositions complètes et confrontations entre joueurs ne sont pas exposés par ce MCP.</p>`;
 $<HTMLDialogElement>('champ-dialog').showModal();
}
function renderMetricOptions(){
  $('metric-menu').innerHTML=Object.entries(metrics).map(([k,label])=>`<label><input type="checkbox" value="${k}" ${shown.includes(k)?'checked':''}>${label}</label>`).join('');
  $('metric-menu').onchange=()=>{const selected=Array.from($('metric-menu').querySelectorAll<HTMLInputElement>('input:checked')).map(i=>i.value);if(!selected.length){renderMetricOptions();return;}shown=selected;updateStats();savePreferences();};
}
function syncFilters(){
 // Older saved drafts keep their champions; unsupported legacy filters are reset explicitly in the UI.
 draft.filter={patch:'all',platform:'all',tier:'all',days:30,queue:draft.filter.queue===440?440:420};
 $<HTMLSelectElement>('filter-queue').value=String(draft.filter.queue);
 $('filter-summary').textContent='All Tiers · région non précisée · patch courant OP.GG';
}
$<HTMLSelectElement>('filter-queue').onchange=()=>{draft.filter.queue=Number($<HTMLSelectElement>('filter-queue').value);syncFilters();changed();savePreferences();void updateCoverage();};
function renderBans(){$('ban-chips').innerHTML=draft.bans.map(id=>`<button class="ban-chip" data-ban="${id}">${esc(name(id))} ×</button>`).join('');}
$('add-ban').onclick=()=>{const input=$<HTMLInputElement>('ban-input'),c=champions.find(c=>norm(c.name)===norm(input.value)||norm(c.id)===norm(input.value));if(!c){toast('Choisis un champion du catalogue.');return;}if(draft.bans.length>=10||[...draft.blue,...draft.red,...draft.bans].includes(c.id)){toast('Champion déjà choisi ou dix bans atteints.');return;}draft.bans.push(c.id);input.value='';renderBans();changed();};
$('ban-chips').onclick=e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-ban]');if(b){draft.bans=draft.bans.filter(c=>c!==b.dataset.ban);renderBans();changed();}};

async function loadProfile(){const profile=await api('profile',{},true);accounts=profile.accounts;const p=profile.preferences;if(p.metrics)shown=p.metrics;if(typeof p.global==='boolean')globalOn=p.global;if(!myPublicIdentity&&typeof p.personal==='boolean')personalOn=p.personal;if(p.filter)draft.filter=p.filter;if(!myPublicIdentity&&(!p.primaryAccountId||!accounts.some(a=>a.id===p.primaryAccountId))){personalOn=false;myAccountId='';}if(!myPublicIdentity&&p.primaryAccountId&&accounts.some(a=>a.id===p.primaryAccountId)){myAccountId=p.primaryAccountId;myRole=p.myRole??1;if(personalOn)associateMe();}$<HTMLInputElement>('stat-global').checked=globalOn;$<HTMLInputElement>('stat-mine').checked=personalOn;renderMetricOptions();syncFilters();renderRows();schedule();}
async function showAccount(){
  $<HTMLDialogElement>('account-dialog').showModal();
  if(!user){$('account-content').innerHTML='<p class="inline-note">Connecte-toi pour conserver tes comptes Riot, tes préférences et tes drafts.</p><button id="google-login" class="mainbtn">Continuer avec Google</button><p class="inline-note">La connexion Google est gérée par Neon Auth. L’association d’un Riot ID reste une déclaration, distincte d’une autorisation Riot Sign On.</p>';
    $('google-login').onclick=async()=>{const button=$<HTMLButtonElement>('google-login');button.disabled=true;button.textContent='Connexion à Google…';try{await authReady;if(user){await showAccountRefresh();return;}if(!auth)throw new Error('Authentification indisponible. Réessaie dans un instant.');const result=await auth.signIn.social({provider:'google',callbackURL:location.origin});if(result.error)throw new Error(result.error.message||'Connexion indisponible.');}catch(e){toast((e as Error).message);button.disabled=false;button.textContent='Continuer avec Google';}};return;
  }
  $('account-content').innerHTML='<p class="inline-note">Chargement de ton espace…</p>';
  try{
    await loadProfile();const history=await api('drafts',{},true);
    $('account-content').innerHTML=`<p class="inline-note">${esc(user.name)} · Ton espace privé</p><button id="logout" class="smallbtn">Se déconnecter</button><h4 class="account-heading">Comptes Riot</h4><p class="inline-note">Associe ton compte ou un joueur dont l’identité est publiquement visible. Cette déclaration ne prouve pas que tu possèdes le compte. Aucun joueur masqué ne peut être recherché via la draft en direct.</p>${accounts.map(a=>`<div class="account-item"><div><strong>${esc(a.game_name+'#'+a.tag_line)}</strong><small>${a.platform} · ID déclaré, RSO non autorisé</small><small>${a.rank_data?.length?a.rank_data.map((r:any)=>esc(r.tier+' '+r.rank+' · '+r.leaguePoints+' LP')).join(' / '):'Rang non fourni'} · ${a.refreshed_at?'Actualisé le '+new Date(a.refreshed_at).toLocaleDateString('fr-FR'):'Actualisation OP.GG en attente'}</small></div><div class="account-actions"><button class="smallbtn" data-account-stats="${a.id}">Stats</button><button class="smallbtn" data-refresh="${a.id}">Actualiser</button><button class="minorbtn" data-remove-account="${a.id}">Retirer</button></div></div>`).join('')}<form class="account-form" id="riot-form"><label>Riot ID<input id="riot-id" placeholder="Pseudo#EUW" required maxlength="60"></label><label>Région<select id="riot-platform">${['EUW1','EUN1','NA1','KR','BR1','JP1','TR1','RU','LA1','LA2','OC1','PH2','SG2','TH2','TW2','VN2'].map(p=>`<option>${p}</option>`).join('')}</select></label><label class="checklabel"><input type="checkbox" required> Je confirme que cette identité est visible ou qu’il s’agit de mon compte. Elle n’est pas masquée par Riot.</label><button class="smallbtn">Associer le Riot ID</button></form><div id="profile-stats" class="profile-stats"></div><h4 class="account-heading">Tes drafts</h4>${history.length?history.map((d:any)=>`<div class="history-item"><div><strong>${esc(d.name)}</strong><small>${new Date(d.updated_at).toLocaleString('fr-FR')} · ${d.state.blue.filter(Boolean).length} alliés</small></div><div class="account-actions"><button class="smallbtn" data-load-draft="${d.id}">Ouvrir</button><button class="minorbtn" data-delete-draft="${d.id}">Supprimer</button></div></div>`).join(''):'<p class="inline-note">Enregistre une draft pour la retrouver ici.</p>'}<details><summary>Mes données</summary><p class="inline-note">Supprime les profils, comptes associés, préférences et drafts de Singe Drafting. Ton compte Google et la session Neon Auth sont conservés.</p><button class="minorbtn" id="delete-profile">Effacer mes données Singe Drafting</button></details>`;
    $('riot-form').onsubmit=async e=>{e.preventDefault();const button=$('riot-form').querySelector('button')!;button.disabled=true;try{await api('accounts',{method:'POST',body:JSON.stringify({riotId:$<HTMLInputElement>('riot-id').value,platform:$<HTMLSelectElement>('riot-platform').value,visibleIdentity:true})},true);toast('Compte associé avec ses agrégats OP.GG.');await showAccountRefresh();}catch(e){toast((e as Error).message);}finally{button.disabled=false;}};
    wirePlayerSearch('riot-id','riot-platform',()=>$<HTMLFormElement>('riot-form').requestSubmit());
    $('logout').onclick=async()=>{try{const result=await auth?.signOut();if(result?.error)throw new Error(result.error.message);user=null;accounts=[];myAccountId='';draft.players=[];personalOn=false;$('personal-banner').hidden=true;shown=['wr','vs','n'];globalOn=true;$<HTMLInputElement>('stat-mine').checked=false;$<HTMLInputElement>('stat-global').checked=true;$('account-btn').textContent='Se connecter';$<HTMLDialogElement>('account-dialog').close();renderMetricOptions();renderRows();changed();}catch{toast('Déconnexion indisponible. Réessaie.');}};
    $('delete-profile').onclick=async()=>{if(!confirm('Effacer tes données Singe Drafting ? Cette suppression est définitive.'))return;await api('profile',{method:'DELETE'},true);accounts=[];draft.players=[];toast('Données Singe Drafting effacées.');await showAccountRefresh();};
    $('account-content').onclick=async e=>{
      const target=e.target as HTMLElement;
      try{
        if(target.dataset.accountStats){const r=await api(`accounts/${target.dataset.accountStats}`,{},true);$('profile-stats').innerHTML=`<h4>Statistiques personnelles</h4><p>OP.GG · saison ${esc(r.context.season??'non précisée')} · ${esc(r.context.gameType||'file non précisée')} · ${r.overall.n??'Volume inconnu'} parties · WR ${value(r.overall,'wr')} · KDA ${value(r.overall,'kda')}</p><ul>${r.champions.map((c:any)=>`<li>${esc(name(c.champion))} : ${value(c.stat,'wr')} · ${c.stat.n} parties</li>`).join('')}</ul><p class="inline-note">Agrégats du profil OP.GG, tous postes. Seuls les champions renvoyés par le fournisseur sont disponibles ; aucun historique brut n’est importé.</p>`;}
        if(target.dataset.refresh){await api(`accounts/${target.dataset.refresh}`,{method:'POST'},true);toast('Agrégats OP.GG actualisés (cache de 15 minutes).');}
        if(target.dataset.removeAccount){await api(`accounts/${target.dataset.removeAccount}`,{method:'DELETE'},true);draft.players=draft.players?.filter(p=>p.accountId!==target.dataset.removeAccount);await showAccountRefresh();}
        if(target.dataset.loadDraft){const saved=history.find((d:any)=>d.id===target.dataset.loadDraft);draft={...saved.state,players:(saved.state.players||[]).filter((p:any)=>accounts.some(a=>a.id===p.accountId))};$<HTMLDialogElement>('account-dialog').close();syncFilters();renderBans();begin('manual');changed();}
        if(target.dataset.deleteDraft){await api(`drafts/${target.dataset.deleteDraft}`,{method:'DELETE'},true);await showAccountRefresh();}
      }catch(e){toast((e as Error).message);}
    };
  }catch(e){if(!user){void showAccount();toast((e as Error).message);}else $('account-content').textContent=(e as Error).message;}
}
async function showAccountRefresh(){$<HTMLDialogElement>('account-dialog').close();await showAccount();}
function selectPlayer(side:Side,slot:number){showIdentitySetup('personal',{side,slot});}
function associateMe(){
 draft.players=(draft.players||[]).filter(p=>!(p.side==='blue'&&p.slot===myRole)&&p.accountId!==myAccountId);
 draft.publicPlayers=(draft.publicPlayers||[]).filter(p=>!(p.side==='blue'&&p.slot===myRole));
 if(myPublicIdentity)draft.publicPlayers.push({side:'blue',slot:myRole,...myPublicIdentity});
 else if(myAccountId)draft.players.push({side:'blue',slot:myRole,accountId:myAccountId});
}
async function refreshPublicPlayers(){
 if(refreshingPublic||!personalOn||Date.now()<publicRetryAt)return;refreshingPublic=true;
 try{for(const p of draft.publicPlayers||[])await api('players/lookup',{method:'POST',body:JSON.stringify({riotId:p.riotId,platform:p.platform})});schedule();}
 catch{publicRetryAt=Date.now()+60000;if(myPublicIdentity)$('personal-banner').textContent='OP.GG ne répond pas pour le profil choisi. Les statistiques générales restent disponibles. Réessaie en cliquant sur Mes stats LoL.';}
 finally{refreshingPublic=false;}
}
async function updateCoverage(){
 try{const c=await api('coverage?queue='+draft.filter.queue);$('coverage-banner').innerHTML=`<a href="https://op.gg/lol/champions" target="_blank" rel="noopener">Statistiques OP.GG</a> · All Tiers · ${c.context?.mode==='flex'?'Flex':'Solo / Duo'} · ${Number(c.completed)||0}/${Number(c.total)||0} champions · ${Number(c.matchups)||0} matchups · ${Number(c.synergies)||0} duos. Couverture mondiale non vérifiable : le MCP ne précise pas les régions.${c.stale?' Derniers agrégats conservés en attendant OP.GG.':''}`;}catch{$('coverage-banner').textContent='OP.GG indisponible. Aucun chiffre fictif ni ancien agrégat Riot utilisé.';}
}
function showLiveLimit(){
 $('identity-title').textContent='Draft en direct';$('identity-content').innerHTML='<p class="inline-note">Le MCP officiel OP.GG ne fournit ni la partie en cours ni la sélection des champions du client. La synchronisation automatique est indisponible avec cette source.</p><p class="inline-note">Saisis rapidement les champions pendant la draft. La recherche au clavier et les recommandations automatiques restent disponibles.</p><button class="mainbtn" id="live-manual">Saisir les champions</button>';$<HTMLDialogElement>('identity-dialog').showModal();$('live-manual').onclick=()=>{$<HTMLDialogElement>('identity-dialog').close();document.querySelector<HTMLInputElement>('[data-combo]')?.focus();};
}
function showIdentitySetup(purpose:'personal'|'live',target?:{side:Side;slot:number}){
 if(purpose==='live'){showLiveLimit();return;}
 const current=target?draft.publicPlayers?.find(p=>p.side===target.side&&p.slot===target.slot):myPublicIdentity;
 const account=accounts.find(a=>a.id===myAccountId),initial=current?.riotId||(account?account.game_name+'#'+account.tag_line:''),platform=current?.platform||account?.platform||'EUW1';
 $('identity-title').textContent=target?'Profil du joueur visible':'Tes statistiques LoL';
 $('identity-content').innerHTML=`<p class="inline-note">Choisis un profil récent ou saisis son Riot ID complet. Aucune connexion Google nécessaire.</p><form class="account-form" id="identity-form"><label for="setup-riot-id">Riot ID</label><input id="setup-riot-id" placeholder="Nom#TAG" required maxlength="60" value="${esc(initial)}"><label for="setup-platform">Région</label><select id="setup-platform">${['EUW1','EUN1','NA1','KR','BR1','JP1','TR1','RU','LA1','LA2','OC1','SG2','TW2','VN2','ME1'].map(p=>`<option ${p===platform?'selected':''}>${p}</option>`).join('')}</select><label for="setup-role">${target?'Poste':'Ton poste'}</label><select id="setup-role" ${target?'disabled':''}>${ROLES.map((r,i)=>`<option value="${i}" ${i===(target?.slot??myRole)?'selected':''}>${r}</option>`).join('')}</select><p class="inline-note">Profils publics uniquement. Ces choix restent sur ce navigateur ; Google est facultatif pour enregistrer tes drafts.</p><button class="mainbtn" id="identity-submit">Charger les statistiques</button>${current?'<button type="button" class="minorbtn" id="remove-public-player">Retirer ce profil</button>':''}<p id="identity-status" class="inline-note" role="status"></p></form>`;
 $<HTMLDialogElement>('identity-dialog').showModal();
 wirePlayerSearch('setup-riot-id','setup-platform',()=>$<HTMLFormElement>('identity-form').requestSubmit());
 $('identity-form').onsubmit=async e=>{e.preventDefault();const button=$<HTMLButtonElement>('identity-submit');button.disabled=true;$('identity-status').textContent='Chargement du profil OP.GG…';
  try{await connectPersonal({riotId:$<HTMLInputElement>('setup-riot-id').value.trim(),platform:$<HTMLSelectElement>('setup-platform').value,role:Number($<HTMLSelectElement>('setup-role').value)},target);$<HTMLDialogElement>('identity-dialog').close();}catch(e){$('identity-status').textContent=(e as Error).message;}finally{button.disabled=false;}
 };
 if(current)$('remove-public-player').onclick=()=>{const side=target?.side||'blue',slot=target?.slot??myRole;draft.publicPlayers=draft.publicPlayers?.filter(p=>p.side!==side||p.slot!==slot);if(!target){myPublicIdentity=null;personalOn=false;try{localStorage.removeItem('singe:my-public-player');}catch{}$('personal-banner').hidden=true;$<HTMLInputElement>('stat-mine').checked=false;}$<HTMLDialogElement>('identity-dialog').close();renderRows();changed();};
}
async function connectPersonal(input:{riotId:string;platform:string;role:number},target?:{side:Side;slot:number}){
 const result=await api('players/lookup',{method:'POST',body:JSON.stringify({riotId:input.riotId,platform:input.platform})}),identity=result.identity as PlayerIdentity;
 rememberPlayer(identity);personalOn=true;
 const side=target?.side||'blue',slot=target?.slot??input.role;
 draft.players=(draft.players||[]).filter(p=>p.side!==side||p.slot!==slot);
 if(!target){const oldRole=myRole;if(myPublicIdentity)draft.publicPlayers=draft.publicPlayers?.filter(p=>p.side!=='blue'||p.slot!==oldRole);myPublicIdentity=identity;myAccountId='';myRole=input.role;try{localStorage.setItem('singe:my-public-player',JSON.stringify({...identity,role:myRole}));}catch{}}
 draft.publicPlayers=[...(draft.publicPlayers||[]).filter(p=>p.side!==side||p.slot!==slot),{side,slot,...identity}];
 $<HTMLInputElement>('stat-mine').checked=true;$('personal-banner').hidden=false;
 $('personal-banner').textContent=`${identity.riotId} · ${identity.platform} · ${ROLES[slot]} · OP.GG : ${result.profile.overall.n??'volume non fourni'} parties (saison ${result.profile.context.season??'non précisée'}, tous postes).`;
 renderRows();changed();savePreferences();
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
$('fill-example').onclick=()=>{draft.blue=['Darius','Fiddlesticks','Ahri',null,null];draft.red=['Garen','Viego','Yasuo','Caitlyn','Nautilus'];draft.selected={blue:[3,4],red:[]};draft.bans=[];renderBans();renderRows();changed();toast('Exemple de sélections uniquement. Les statistiques viennent des agrégats OP.GG.');};
$('stat-global').onchange=()=>{globalOn=$<HTMLInputElement>('stat-global').checked;updateStats();savePreferences();};$('stat-mine').onchange=async()=>{if($<HTMLInputElement>('stat-mine').checked){showIdentitySetup('personal');}else{personalOn=false;$('personal-banner').hidden=true;updateStats();savePreferences();}};
$('config-btn').onclick=()=>{const p=$('config-panel');p.hidden=!p.hidden;$('config-btn').setAttribute('aria-expanded',String(!p.hidden));};
async function init(){
  authReady=initializeAuth();
  try{const saved=JSON.parse(localStorage.getItem('singe:draft:v1')||'null');if(saved?.blue?.length===5&&saved?.red?.length===5&&saved.filter&&saved.selected){draft={...saved,players:[]};}}catch{}
  syncFilters();renderRows();renderBans();renderMetricOptions();
  const cat=await fetch('/data/catalog.json').then(r=>r.ok?r.json():null).catch(()=>null);if(cat?.champions){champions=cat.champions;$('champion-list').innerHTML=champions.map(c=>`<option value="${esc(c.name)}">`).join('');renderRows();}
  try{const saved=JSON.parse(localStorage.getItem('singe:my-public-player')||'null');if(saved?.riotId&&saved?.platform){myPublicIdentity={riotId:saved.riotId,platform:saved.platform};myRole=saved.role??1;personalOn=true;associateMe();$<HTMLInputElement>('stat-mine').checked=true;$('personal-banner').hidden=false;$('personal-banner').textContent='Profil public : '+saved.riotId;void refreshPublicPlayers();}}catch{}
  await authReady;
  try{const pending=JSON.parse(sessionStorage.getItem('singe:pending-riot')||'null');if(pending){sessionStorage.removeItem('singe:pending-riot');begin('manual');await connectPersonal(pending);}}catch(e){toast((e as Error).message);}
  void updateCoverage();
  if(location.search.includes('error='))toast('La connexion Google n’a pas abouti. Réessaie depuis ton espace.');
  schedule();
}
async function initializeAuth(){
  try{const config=await api('config');if(config.authUrl){auth=makeAuth(config.authUrl);const session=await auth.getSession();if(session.error)throw new Error(session.error.message||'Session indisponible.');if(session.data?.user){user=session.data.user as {id:string;name:string};$('account-btn').textContent=user.name||'Mon espace';try{await loadProfile();}catch{ /* Public profile lookup does not depend on the private account. */ }}}}catch{ /* Anonymous drafting remains available. */ }
}
void init();
setInterval(()=>{if(!document.hidden&&$('page-draft').classList.contains('on')&&!openPick){if(personalOn&&draft.publicPlayers?.length)void refreshPublicPlayers();else schedule();}},180000);
