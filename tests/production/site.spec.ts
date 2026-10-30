import {test,expect} from '@playwright/test';
test('Published assets, live API, draft and protected profile',async({page,request})=>{
  const response=await request.get('/api/health');expect(response.status()).toBe(200);const health=await response.json();expect(health.database).toBe('reachable');
  expect((await request.get('/api/profile')).status()).toBe(401);
  await page.goto('/');await expect(page.locator('#monkey-photo')).toBeVisible();
  expect(await page.locator('#monkey-photo').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBeTruthy();
  await page.locator('#begin-manual').click();
  const input=page.getByRole('combobox',{name:'Alliés TOP, champion'});await input.fill('Darius');await input.press('Enter');
  await expect(page.locator('#auto-status')).toContainText('À jour',{timeout:30000});
  expect(await page.locator('.champ-thumb img').first().evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBeTruthy();
  await page.getByRole('button',{name:'Statistiques de Darius'}).click();await expect(page.locator('#champ-dialog-body')).toContainText('Riot Match-V5');await page.locator('#close-champ').click();
  await page.locator('#account-btn').click();await expect(page.locator('#google-login')).toBeVisible();await page.locator('#close-account').click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBeTruthy();
  await page.screenshot({path:`test-results/published-${test.info().project.name}.png`,fullPage:true});
});
test('Google login initiates an authorized provider redirect',async({page})=>{
  await page.goto('/');await page.locator('#account-btn').click();
  const session=page.waitForResponse(r=>r.url().includes('/sign-in/social'),{timeout:30000});
  await page.locator('#google-login').click();const response=await session;expect(response.ok()).toBeTruthy();
  const result=await response.json();expect(result.url).toMatch(/^https:\/\/(accounts\.google\.com|[^/]+\.neon\.(tech|build|com))\//);
  // Stop at the provider boundary. No identity, password, consent or fake user is used.
});
