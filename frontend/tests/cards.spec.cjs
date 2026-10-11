const {test,expect}=require('@playwright/test');
test('same dashboard switches domains and shows independent evidence on desktop and mobile',async({page,request})=>{
 test.setTimeout(60000);
 const customer=await(await request.get('/api/overview')).json();
 const cards=await(await request.get('/api/overview?domain=CARDS')).json();
 const findings=await(await request.get('/api/findings?domain=CARDS')).json();
 await page.goto('/');await expect(page.getByRole('heading',{name:'See the gaps. Test with confidence.'})).toBeVisible();
 const selector=page.getByRole('combobox',{name:'Banking workspace domain'});
 await selector.selectOption('CARDS');
 await expect(page.locator('.environment-strip')).toContainText('prod_cards');await expect(page.locator('.environment-strip')).toContainText('test_cards');
 await expect(page.locator('.metric-card').nth(2).locator('.metric-value')).toHaveText(String(cards.missing_data_states));
 for(const kind of ['REPRESENTATION_GAP','MISSING_STATE','DATA_HEALTH_ISSUE']){
  const f=findings.find(f=>f.finding_type===kind);await page.locator('.pattern-button').filter({hasText:f.title}).click();
  const dialog=page.getByRole('dialog');await expect(dialog).toContainText(f.title);await expect(dialog.getByRole('heading',{name:'AI Explanation',exact:true})).toBeVisible();
  await dialog.locator('.technical-evidence summary').click();await expect(dialog.locator('pre').first()).toContainText(f.evidence.calculation_method);
  if(kind==='DATA_HEALTH_ISSUE'){await expect(dialog.locator('.context-used')).toContainText('BR-CARD-001');await expect(dialog.locator('.context-used')).not.toContainText('BR-CUSTOMER-001');await expect(dialog.locator('.ai-status')).not.toHaveAttribute('data-status','PENDING',{timeout:15000});}
  await page.getByRole('button',{name:'Close finding'}).click();
 }
 await page.getByRole('button',{name:'State coverage',exact:true}).click();await expect(page.locator('main')).toContainText('8-feature combinations');
 await page.getByRole('button',{name:'Fingerprints',exact:true}).click();await expect(page.locator('.fingerprints-panel')).toContainText('card_limit');await expect(page.locator('.fingerprints-panel')).not.toContainText('customer relationships');
 await page.setViewportSize({width:390,height:844});await expect(selector).toBeVisible();await selector.selectOption('CUSTOMER_LENDING');
 await expect(page.locator('.environment-strip')).toContainText('prod_snapshot');await expect(page.locator('.fingerprints-panel')).toContainText('customer relationships');
 await selector.selectOption('CARDS');await expect(page.locator('.environment-strip')).toContainText('prod_cards');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.reload();await expect(selector).toHaveValue('CARDS');await expect(page.locator('.environment-strip')).toContainText('prod_cards');
 const after=await(await request.get('/api/overview')).json();expect(after).toEqual(customer);
});
test('domain boundary rejects cross-domain detail and invalid domain',async({request})=>{
 const cards=await(await request.get('/api/findings?domain=CARDS')).json();
 expect((await request.get('/api/findings/'+encodeURIComponent(cards[0].finding_id))).status()).toBe(404);
 expect((await request.get('/api/overview?domain=UNRECOGNIZED')).status()).toBe(400);
});
