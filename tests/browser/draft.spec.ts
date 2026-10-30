import {test,expect} from '@playwright/test';
import {emptySnapshot} from '../../server/opgg-store.ts';
import {Engine} from '../../server/engine.ts';
import fallback from '../../src/champions-fallback.json' with {type:'json'};
test.beforeEach(async({page})=>{
  await page.route('**/data/catalog.json',route=>route.fulfill({json:{version:'test',champions:fallback}}));
  await page.route('**/api/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path==='/api/analyze'){const draft=route.request().postDataJSON();await route.fulfill({json:new Engine(emptySnapshot(fallback,'ranked')).analyze(draft)});return;}
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
