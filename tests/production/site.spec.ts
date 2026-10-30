import {test,expect} from '@playwright/test';
test('Published assets, live API, draft and protected profile',async({page,request})=>{
  const response=await request.get('/api/health');expect(response.status()).toBe(200);const health=await response.json();expect(health.database).toBe('reachable');expect(health.source).toBe('OP.GG MCP');expect(health.riotApiEnabled).toBe(false);expect(health.coveredChampions).toBeGreaterThan(100);
  expect((await request.get('/api/profile')).status()).toBe(401);
  await page.goto('/');await expect(page.locator('#monkey-photo')).toBeVisible();
  expect(await page.locator('#monkey-photo').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBeTruthy();
  await page.locator('#begin-manual').click();
  const input=page.getByRole('combobox',{name:'Alliés TOP, champion'});await input.fill('Darius');await input.press('Enter');
  await expect(page.locator('#auto-status')).toContainText('À jour',{timeout:30000});
  expect(await page.locator('.champ-thumb img').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBeTruthy();
  await page.getByRole('button',{name:'Statistiques de Darius'}).click();await expect(page.locator('#champ-dialog-body')).toContainText('OP.GG MCP');await page.locator('#close-champ').click();
  if(await page.locator('[data-apply-side="blue"]').count()){
    await page.locator('[data-apply-side="blue"]').first().click();
    await expect(page.getByRole('combobox',{name:'Alliés TOP, champion'})).toHaveValue('Darius');
    for(const role of ['JUNGLE','MID','ADC','SUPPORT'])await expect(page.getByRole('combobox',{name:`Alliés ${role}, champion`})).not.toHaveValue('');
    await expect(page.locator('#auto-status')).toContainText('À jour',{timeout:30000});
    await expect(page.locator('#applied-overview')).toContainText('5 champion(s)');
  }else await expect(page.locator('#analysis-results')).toContainText('Pas encore assez');
  await expect(page.locator('#coverage-banner')).toContainText('Couverture mondiale non vérifiable');
  await page.locator('#account-btn').click();await expect(page.locator('#google-login')).toBeVisible();await page.locator('#close-account').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.screenshot({path:`test-results/published-${test.info().project.name}.png`,fullPage:true});
});
test('Google login initiates an authorized provider redirect',async({page})=>{
  await page.goto('/');await page.locator('#account-btn').click();
  let result:any;
  await page.route('**/sign-in/social',async route=>{
    const response=await route.fetch();expect(response.ok()).toBeTruthy();
    result=await response.json();await route.fulfill({response,json:result});
  });
  await page.locator('#google-login').click();
  await expect.poll(()=>result?.url,{timeout:30000}).toMatch(/^https:\/\/(accounts\.google\.com|[^/]+\.neon\.(tech|build|com))\//);
  // Stop at the provider boundary. No identity, password, consent or fake user is used.
});

test('Personal Riot ID entry and honest live mode are accessible',async({page})=>{
  await page.goto('/');await page.locator('#begin-manual').click();await page.locator('#stat-mine').check();
  await expect(page.locator('#setup-riot-id')).toBeVisible();await expect(page.locator('#setup-role')).toBeVisible();await page.locator('#close-identity').click();
  await page.locator('#back').click();await page.locator('#begin-live').click();await expect(page.locator('#identity-content')).toContainText('Le MCP officiel OP.GG');await expect(page.locator('#live-manual')).toBeVisible();
});

test('Public OP.GG profile loads without Google and appears in the recent-name dropdown',async({page,request})=>{
 test.setTimeout(60000);
 const response=await request.post('/api/players/lookup',{data:{riotId:'Faker#KR  1',platform:'KR'}});expect(response.status()).toBe(200);const profile=await response.json();expect(profile.profile.overall.n).toBeGreaterThan(0);
 await page.goto('/');await page.locator('#begin-manual').click();await page.locator('#stat-mine').check();await page.locator('#setup-platform').selectOption('KR');await page.locator('#setup-riot-id').fill(profile.identity.riotId);await page.locator('#setup-role').selectOption('3');await page.locator('#identity-submit').click();await expect(page.locator('#identity-dialog')).not.toBeVisible({timeout:30000});
 await expect(page.locator('#personal-banner')).toContainText(profile.identity.riotId);await expect(page.locator('#google-login')).toHaveCount(0);
 const input=page.getByRole('combobox',{name:'Alliés ADC, champion'});await input.fill('KogMaw');await input.press('Enter');await expect(page.locator('#auto-status')).toContainText('À jour',{timeout:30000});
 await expect(page.locator('.pick.blue[data-slot="3"] .src-label.mine')).toBeVisible();
 await page.locator('#stat-mine').uncheck();await page.locator('#stat-mine').check();await page.locator('#setup-riot-id').fill('Fak');await expect(page.locator('.player-results [role=option]')).toHaveCount(1);await page.locator('.player-results [role=option]').click();await expect(page.locator('#identity-dialog')).not.toBeVisible();
});
