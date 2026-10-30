export interface PlayerIdentity{riotId:string;platform:string;}
const RECENTS='singe:recent-players';
export function recentPlayers():PlayerIdentity[]{try{const rows=JSON.parse(localStorage.getItem(RECENTS)||'[]');return Array.isArray(rows)?rows.filter(x=>typeof x.riotId==='string'&&typeof x.platform==='string').slice(0,12):[];}catch{return [];}}
export function rememberPlayer(value:PlayerIdentity){const rows=[value,...recentPlayers().filter(x=>x.platform!==value.platform||x.riotId.toLowerCase()!==value.riotId.toLowerCase())].slice(0,12);try{localStorage.setItem(RECENTS,JSON.stringify(rows));}catch{}}
export function attachPlayerSearch(input:HTMLInputElement,region:HTMLSelectElement,extra:()=>PlayerIdentity[],search:(q:string,platform:string,signal:AbortSignal)=>Promise<{suggestions:PlayerIdentity[]}>,choose:(value:PlayerIdentity)=>void){
 const wrap=document.createElement('div');wrap.className='player-search';input.replaceWith(wrap);wrap.append(input);
 const list=document.createElement('div');list.className='player-results';list.id=input.id+'-results';list.role='listbox';list.hidden=true;wrap.append(list);
 const hint=document.createElement('small');hint.className='player-search-hint';hint.id=input.id+'-hint';hint.textContent='Profils récents proposés dès les premières lettres. Nouveau profil : Nom#TAG (requis par OP.GG).';wrap.append(hint);
 input.role='combobox';input.autocomplete='off';input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-controls',list.id);input.setAttribute('aria-expanded','false');input.setAttribute('aria-describedby',hint.id);
 let timer:ReturnType<typeof setTimeout>,controller:AbortController|null=null,sequence=0,active=-1,options:PlayerIdentity[]=[];
 const close=()=>{input.removeAttribute('aria-busy');list.hidden=true;input.setAttribute('aria-expanded','false');active=-1;};
 const mark=()=>{Array.from(list.children).forEach((n,i)=>{n.classList.toggle('active',i===active);n.setAttribute('aria-selected',String(i===active));});};
 const select=(i:number)=>{const value=options[i];if(!value)return;controller?.abort();clearTimeout(timer);sequence++;input.value=value.riotId;region.value=value.platform;close();choose(value);};
 const render=(rows:PlayerIdentity[])=>{options=[...new Map(rows.map(x=>[x.platform+':'+x.riotId.toLowerCase(),x])).values()].slice(0,8);list.replaceChildren();active=-1;
  options.forEach((x,i)=>{const b=document.createElement('button');b.type='button';b.role='option';b.className='player-result';b.textContent=x.riotId+' · '+x.platform;b.addEventListener('pointerdown',e=>e.preventDefault());b.onclick=()=>select(i);list.append(b);});list.hidden=!options.length;input.setAttribute('aria-expanded',String(!!options.length));};
 const update=()=>{input.removeAttribute('aria-busy');clearTimeout(timer);controller?.abort();const current=++sequence,q=input.value.trim(),platform=region.value;
  const local=[...recentPlayers(),...extra()].filter(x=>x.platform===platform&&x.riotId.toLowerCase().startsWith(q.toLowerCase()));render(local);
  hint.textContent='Profils récents proposés dès les premières lettres. Nouveau profil : Nom#TAG (requis par OP.GG).';
  if(q.length<3||!q.includes('#')||q.endsWith('#'))return;
  timer=setTimeout(async()=>{controller=new AbortController();input.setAttribute('aria-busy','true');try{const data=await search(q,platform,controller.signal);if(current===sequence){render([...local,...data.suggestions]);hint.textContent=options.length?'Clique sur ton profil pour charger ses statistiques.':'Aucun profil correspondant renvoyé par OP.GG. Vérifie le nom, le tag et la région.';}}catch(e){if(current===sequence&&(e as Error).name!=='AbortError')hint.textContent='Suggestions OP.GG indisponibles. Tu peux saisir le Riot ID complet et charger le profil.';}finally{if(current===sequence)input.removeAttribute('aria-busy');}},500);
 };
 input.addEventListener('input',update);input.addEventListener('focus',update);region.addEventListener('change',update);
 input.addEventListener('keydown',e=>{if(e.key==='Escape'){controller?.abort();clearTimeout(timer);sequence++;close();}if(!options.length||list.hidden)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();active=Math.max(0,Math.min(options.length-1,active+(e.key==='ArrowDown'?1:-1)));mark();}if(e.key==='Enter'){e.preventDefault();select(active<0?0:active);}});
 input.addEventListener('blur',()=>setTimeout(()=>{if(!wrap.contains(document.activeElement)){controller?.abort();clearTimeout(timer);sequence++;close();}},100));
}
