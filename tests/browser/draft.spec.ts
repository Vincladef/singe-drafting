import {test,expect} from '@playwright/test';
import {emptySnapshot} from '../../server/opgg-store.ts';
import {normalizeProfile} from '../../server/opgg-player.ts';
import {Engine} from '../../server/engine.ts';
import fallback from '../../src/champions-fallback.json' with {type:'json'};
const publicFixture=normalizeProfile({data:{summoner:{game_name:'Visible',tagline:'TAG',most_champions:{play:50,win:30,season_id:33,game_type:'RANKED',champion_stats:[{id:122,champion_name:'Darius',play:20,win:14}]}}}},{game_name:'Visible',tag_line:'TAG'},fallback);
test.beforeEach(async({page})=>{
  await page.route('**/data/catalog.json',route=>route.fulfill({json:{version:'test',champions:fallback}}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/analyze'){const draft=route.request().postDataJSON();const players:{blue:Record<number,string>;red:Record<number,string>}={blue:{},red:{}};for(const p of draft.publicPlayers||[])players[p.side as 'blue'|'red'][p.slot]='public-test';await route.fulfill({json:new Engine(emptySnapshot(fallback,'ranked'),{'public-test':publicFixture}).analyze(draft,players)});return;}
    if(path==='/api/players/suggest'){await route.fulfill({json:{suggestions:[],requiresTag:true}});return;}
    await route.fulfill({json:path==='/api/metadata'?{patches:[]}:path==='/api/coverage'?{completed:0,total:173,matchups:0,synergies:0}:{authUrl:null}});
  });
  await page.goto('/');
});
test('Home, manual draft, search, keyboard, duplicates, details and missing data',async({page})=>{
  await expect(page.getByRole('heading',{name:'La draft. En plus malin.'})).toBeVisible();
  await page.locator('#begin-manual').click();
  const input=page.getByRole('combobox',{name:'Alliés TOP, champion'});await input.fill('Darius');await input.press('Enter');
  await expect(input).toHaveValue('Darius');await expect(page.getByRole('checkbox',{name:'Optimiser TOP allié'})).toHaveCount(0);
  await page.getByRole('combobox',{name:'Adversaires TOP, champion'}).fill('Darius');await expect(page.locator('[data-side=red][data-slot="0"] [data-champ=Darius]')).toBeDisabled();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Statistiques de Darius'}).click();await expect(page.getByRole('dialog',{name:'Darius'})).toBeVisible();await expect(page.locator('#champ-dialog-body')).toContainText('aucun taux simulé');await page.locator('#close-champ').click();
  await expect(page.locator('#data-status')).toContainText('OP.GG MCP');await expect(page.locator('#analysis-results')).toContainText('Pas encore assez');
});
test('One through five optimization slots and persistence',async({page})=>{
  await page.locator('#begin-manual').click();const checks=page.locator('.slot-wrap.blue .slot-analyze');
  for(let i=0;i<4;i++)await checks.nth(i).uncheck();await expect(page.locator('.slot-wrap.blue .slot-analyze:checked')).toHaveCount(1);
  await expect(page.locator('#selection-summary')).toContainText('1 poste(s) allié(s)');
  for(let i=0;i<4;i++)await checks.nth(i).check();await expect(page.locator('#selection-summary')).toContainText('5 poste(s) allié(s)');
  await page.locator('#fill-example').click();await expect(page.getByRole('combobox',{name:'Alliés JUNGLE, champion'})).toHaveValue('Fiddlesticks');
  await page.reload();await page.locator('#begin-manual').click();await expect(page.getByRole('combobox',{name:'Alliés JUNGLE, champion'})).toHaveValue('Fiddlesticks');
});
test('Live honestly explains provider limits and opens fast manual input',async({page})=>{
 await page.locator('#begin-live').click();await expect(page.locator('#identity-dialog')).toBeVisible();await expect(page.locator('#identity-content')).toContainText('ne fournit ni la partie en cours');
 await expect(page.locator('#setup-riot-id')).toHaveCount(0);await page.locator('#live-manual').click();await expect(page.locator('#identity-dialog')).not.toBeVisible();await expect(page.locator('#draft-mode')).toHaveText('DRAFT EN DIRECT · SAISIE RAPIDE');
});
test('Personal statistics asks for Riot ID, region and role before enabling data',async({page})=>{
  await page.locator('#begin-manual').click();await page.locator('#stat-mine').check();
  await expect(page.locator('#identity-dialog')).toBeVisible();await expect(page.getByLabel('Riot ID',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Région',{exact:true})).toBeVisible();await expect(page.getByLabel('Ton poste',{exact:true})).toBeVisible();
  await page.locator('#close-identity').click();await expect(page.locator('#stat-mine')).not.toBeChecked();
});
test('Filters, bans, optional AI and responsive layout',async({page})=>{
  await page.locator('#begin-manual').click();await page.locator('.filters summary').click();await expect(page.locator('#filter-days')).toBeDisabled();await page.locator('#filter-queue').selectOption('440');
  await page.locator('#ban-input').fill('Ahri');await page.locator('#add-ban').click();await expect(page.locator('#ban-chips')).toContainText('Ahri');
  await page.locator('#ai-panel summary').click();await page.locator('#ai-analyze').click();await expect(page.locator('#google-login')).toBeVisible();await page.locator('#close-account').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
});

test('Public personal statistics load without Google, affect cards, restore and offer a clickable recent profile',async({page})=>{
 let lookups=0;await page.route('**/api/players/lookup',async route=>{expect(route.request().headers().authorization).toBeUndefined();expect(route.request().postDataJSON()).toMatchObject({riotId:'Visible#TAG',platform:'EUW1'});lookups++;await route.fulfill({json:{identity:{riotId:'Visible#TAG',platform:'EUW1'},profile:publicFixture}});});
 await page.locator('#begin-manual').click();await page.locator('#stat-mine').check();await expect(page.locator('#identity-content')).toContainText('Aucune connexion Google nécessaire');
 await page.locator('#setup-riot-id').fill('Visible#TAG');await page.locator('#setup-role').selectOption('0');await page.locator('#identity-submit').click();await expect(page.locator('#identity-dialog')).not.toBeVisible();
 const c=page.getByRole('combobox',{name:'Alliés TOP, champion'});await c.fill('Darius');await c.press('Enter');
 await expect(page.locator('.pick.blue[data-slot="0"]')).toContainText('70,0 %');await expect(page.locator('#personal-banner')).toContainText('50 parties');await expect(page.locator('#google-login')).toHaveCount(0);
 await page.reload();await page.locator('#begin-manual').click();await expect(page.locator('#stat-mine')).toBeChecked();await expect(page.locator('.pick.blue[data-slot="0"]')).toContainText('70,0 %');
 await page.locator('#stat-mine').uncheck();await page.locator('#stat-mine').check();await page.locator('#setup-riot-id').fill('Vis');await expect(page.getByRole('option',{name:'Visible#TAG · EUW1'})).toBeVisible();await page.getByRole('option',{name:'Visible#TAG · EUW1'}).click();await expect(page.locator('#identity-dialog')).not.toBeVisible();expect(lookups).toBeGreaterThan(1);
});
test('Player dropdown supports keyboard selection and filters to the selected region',async({page})=>{
 await page.evaluate(()=>localStorage.setItem('singe:recent-players',JSON.stringify([{riotId:'Visible#TAG',platform:'EUW1'},{riotId:'Visible#NA',platform:'NA1'}])));
 await page.route('**/api/players/lookup',route=>route.fulfill({json:{identity:{riotId:'Visible#TAG',platform:'EUW1'},profile:publicFixture}}));
 await page.locator('#begin-manual').click();await page.locator('#stat-mine').check();const input=page.locator('#setup-riot-id');await input.fill('Vis');await expect(page.locator('.player-results [role=option]')).toHaveCount(1);await input.press('ArrowDown');await input.press('Enter');await expect(page.locator('#identity-dialog')).not.toBeVisible();
});
test('A restored Google session with Neon cached JWT can open its private profile',async({page})=>{
 const jwt='header.'+Buffer.from(JSON.stringify({exp:Math.floor(Date.now()/1000)+900})).toString('base64url')+'.signature',now=new Date().toISOString();let authorized=0;
 await page.route('**/api/config',route=>route.fulfill({json:{authUrl:'http://127.0.0.1:5173/auth'}}));
 await page.route('**/auth/**',route=>route.fulfill({headers:{'set-auth-jwt':jwt},json:{session:{id:'test-session',userId:'test-user',token:jwt,expiresAt:new Date(Date.now()+86400000).toISOString(),createdAt:now,updatedAt:now},user:{id:'test-user',name:'Test user',email:'test@example.test',emailVerified:true,createdAt:now,updatedAt:now}}}));
 await page.route('**/api/profile',route=>{expect(route.request().headers().authorization).toBe('Bearer '+jwt);authorized++;return route.fulfill({json:{preferences:{},accounts:[]}});});
 await page.route('**/api/drafts',route=>route.fulfill({json:[]}));await page.reload();await expect(page.locator('#account-btn')).toHaveText('Test user');await page.locator('#account-btn').click();await expect(page.locator('#account-content')).toContainText('Ton espace privé');await expect(page.locator('#account-content')).not.toContainText('Session expirée');expect(authorized).toBeGreaterThan(0);
});
