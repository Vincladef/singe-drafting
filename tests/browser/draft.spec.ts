import {test,expect} from '@playwright/test';
import {Engine} from '../../server/engine.ts';
import fallback from '../../src/champions-fallback.json' with {type:'json'};
test.beforeEach(async({page})=>{
  await page.route('**/data/catalog.json',route=>route.fulfill({json:{version:'test',champions:fallback}}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/analyze'){const draft=route.request().postDataJSON();await route.fulfill({json:new Engine([],fallback).analyze(draft)});return;}
    await route.fulfill({json:path==='/api/metadata'?{patches:[]}:path==='/api/coverage'?{recent:0,total:0}:{authUrl:null}});
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
  await expect(page.locator('#data-status')).toContainText('0 matchs');await expect(page.locator('#analysis-results')).toContainText('Pas encore assez');
});
test('One through five optimization slots and persistence',async({page})=>{
  await page.locator('#begin-manual').click();const checks=page.locator('.slot-wrap.blue .slot-analyze');
  for(let i=0;i<4;i++)await checks.nth(i).uncheck();await expect(page.locator('.slot-wrap.blue .slot-analyze:checked')).toHaveCount(1);
  await expect(page.locator('#selection-summary')).toContainText('1 poste(s) allié(s)');
  for(let i=0;i<4;i++)await checks.nth(i).check();await expect(page.locator('#selection-summary')).toContainText('5 poste(s) allié(s)');
  await page.locator('#fill-example').click();await expect(page.getByRole('combobox',{name:'Alliés JUNGLE, champion'})).toHaveValue('Fiddlesticks');
  await page.reload();await page.locator('#begin-manual').click();await expect(page.getByRole('combobox',{name:'Alliés JUNGLE, champion'})).toHaveValue('Fiddlesticks');
});
test('Live asks for a Riot ID and sends a real API request',async({page})=>{
  await page.route('**/api/live',async route=>{expect(route.request().postDataJSON()).toMatchObject({riotId:'Visible#EUW',platform:'EUW1'});await route.fulfill({json:{status:'not_in_game',message:'Aucune partie commencée visible. La sélection des champions est inaccessible.'}});});
  await page.locator('#begin-live').click();await expect(page.locator('#identity-dialog')).toBeVisible();
  await page.getByLabel('Riot ID',{exact:true}).fill('Visible#EUW');await page.locator('#identity-submit').click();
  await expect(page.locator('#identity-status')).toContainText('Aucune partie commencée');
  await expect(page.locator('#draft-mode')).toHaveText('PARTIE EN DIRECT · RECHERCHE RIOT');
});
test('Personal statistics asks for Riot ID, region and role before enabling data',async({page})=>{
  await page.locator('#begin-manual').click();await page.locator('#stat-mine').check();
  await expect(page.locator('#identity-dialog')).toBeVisible();await expect(page.getByLabel('Riot ID',{exact:true})).toBeVisible();
  await expect(page.getByLabel('Région',{exact:true})).toBeVisible();await expect(page.getByLabel('Ton poste',{exact:true})).toBeVisible();
  await page.locator('#close-identity').click();await expect(page.locator('#stat-mine')).not.toBeChecked();
});
test('Live imports only the returned champions after role confirmation',async({page})=>{
  const teams=[{team:100,champions:['Garen','Viego','Yasuo','Caitlyn','Nautilus'].map(champion=>({champion}))},{team:200,champions:['Darius','Fiddlesticks','Ahri','Jinx','Lulu'].map(champion=>({champion}))}];
  await page.route('**/api/live',route=>route.fulfill({json:{status:'in_game',account:{riotId:'Visible#EUW'},game:{gameId:'123',teams,trackedTeam:200,bans:[],source:'Riot Spectator-V5'}}}));
  await page.locator('#begin-live').click();await page.locator('#setup-riot-id').fill('Visible#EUW');await page.locator('#identity-submit').click();
  for(const team of [100,200])for(let i=0;i<5;i++)await page.locator(`[data-live-team="${team}"]`).nth(i).selectOption(String(i));
  await page.getByRole('button',{name:'Importer les champions et analyser'}).click();
  await expect(page.getByRole('combobox',{name:'Alliés TOP, champion'})).toHaveValue('Darius');
  await expect(page.getByRole('combobox',{name:'Adversaires ADC, champion'})).toHaveValue('Caitlyn');
});
test('Filters, bans, optional AI and responsive layout',async({page})=>{
  await page.locator('#begin-manual').click();await page.locator('.filters summary').click();await page.locator('#filter-days').selectOption('7');
  await page.locator('#ban-input').fill('Ahri');await page.locator('#add-ban').click();await expect(page.locator('#ban-chips')).toContainText('Ahri');
  await page.locator('#ai-panel summary').click();await page.locator('#ai-analyze').click();await expect(page.locator('#google-login')).toBeVisible();await page.locator('#close-account').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1)).toBeTruthy();
});
