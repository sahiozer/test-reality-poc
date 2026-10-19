const {test,expect}=require('@playwright/test');

async function openPipeline(page){
 await page.goto('/');
 await page.getByRole('button',{name:'Fingerprint Pipeline',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fingerprint Pipeline',exact:true})).toBeVisible();
 await expect(page.locator('.pipeline-stage')).toHaveCount(8);
}

for(const domain of ['CUSTOMER_LENDING','CARDS']){
 test(`pipeline shows saved ${domain} metrics, all stages and unchanged navigation`,async({page,request})=>{
  const cards=domain==='CARDS',suffix=cards?'?domain=CARDS':'';
  const overview=await(await request.get('/api/overview'+suffix)).json();
  const coverage=await(await request.get('/api/states/coverage'+suffix)).json();
  const fingerprints=await(await request.get('/api/fingerprints'+suffix)).json();
  const findings=await(await request.get('/api/findings'+suffix)).json();
  expect(fingerprints.length).toBe(cards?164:130);expect(findings.length).toBe(cards?61:31);
  expect([coverage.represented_in_test,coverage.total_significant_prod_states]).toEqual(cards?[58,110]:[44,70]);
  await page.addInitScript(domain=>localStorage.setItem('test-reality-domain',domain),domain);
  await openPipeline(page);
  await expect(page.getByTestId('pipeline-fingerprints')).toHaveText(String(fingerprints.length));
  await expect(page.getByTestId('pipeline-findings')).toHaveText(String(findings.length));
  await expect(page.getByTestId('pipeline-coverage')).toHaveText(`${coverage.represented_in_test} / ${coverage.total_significant_prod_states}`);
  const stages=page.locator('.pipeline-stage'),detail=page.locator('#pipeline-detail');
  for(const env of overview.environments)await expect(detail).toContainText(env);
  const rates=cards?['20.36%','2.22%']:['32.47%','7.51%'];
  for(let i=0;i<8;i++){
   await stages.nth(i).click();await expect(stages.nth(i)).toHaveAttribute('aria-pressed','true');
   await expect(detail.locator('.pipeline-io')).toContainText('INPUTS');
   await expect(detail.locator('.pipeline-io')).toContainText('OUTPUTS');
   if(i===1)await expect(detail).toContainText(cards?'card_status_history':'customer.customer_id');
   if(i===2)await expect(detail).toContainText('100,000,000 rows');
   if(i===4||i===5)for(const rate of rates)await expect(detail.locator('.pipeline-comparison')).toContainText(rate);
   if(i===6){
    await expect(detail.locator('.pipeline-finding-chips span')).toHaveCount(4);
    await expect(detail).toContainText(`${overview.freshness.age_difference_days} days`);
    await expect(detail).toContainText(`${Math.floor(overview.test_data_age_days)} days`);
   }
   if(i===7){await expect(detail).toContainText(cards?'BR-CARD-001':'BR-CUSTOMER-001');await expect(detail).not.toContainText(cards?'BR-CUSTOMER-001':'BR-CARD-001');}
  }
  const timestamp=await page.evaluate(iso=>new Date(iso).toLocaleString(),overview.generated_at);
  await expect(page.getByRole('region',{name:'Latest analysis'})).toContainText(timestamp);
  await page.reload();await expect(page.getByRole('combobox',{name:'Banking workspace domain'})).toHaveValue(domain);
  await page.getByRole('button',{name:'Fingerprint Pipeline',exact:true}).click();
  await expect(page.getByTestId('pipeline-fingerprints')).toHaveText(String(fingerprints.length));
  for(const [nav,heading] of [['Fingerprints','Environment fingerprints'],['State coverage',`${coverage.represented_in_test} / ${coverage.total_significant_prod_states} states represented`],['Findings','Every finding, backed by evidence.'],['Overview','See the gaps. Test with confidence.']]){
   await page.getByRole('button',{name:nav,exact:nav!=='Findings'}).first().click();
   await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();
  }
 });
}

test('walkthrough advances, stops and never sends API requests or creates jobs',async({page})=>{
 await page.clock.install();await openPipeline(page);
 const calls=[];page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});
 await page.getByRole('button',{name:'Play walkthrough'}).click();
 for(let i=0;i<8;i++){
  await expect(page.locator('.pipeline-stage').nth(i)).toHaveAttribute('aria-pressed','true');
  await page.clock.fastForward(1500);
 }
 await expect(page.getByRole('button',{name:'Play walkthrough'})).toBeVisible();
 await page.getByRole('button',{name:'Play walkthrough'}).click();await page.clock.fastForward(1500);
 await page.getByRole('button',{name:'Stop walkthrough'}).click();await page.clock.fastForward(4500);
 await expect(page.locator('.pipeline-stage').nth(1)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play walkthrough'}).click();await page.locator('.pipeline-stage').nth(5).click();
 await expect(page.getByRole('button',{name:'Play walkthrough'})).toBeVisible();await page.clock.fastForward(3000);
 await expect(page.locator('.pipeline-stage').nth(5)).toHaveAttribute('aria-pressed','true');
 expect(calls).toEqual([]);
});

test('keyboard selection, reduced motion and technical disclosure work',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await openPipeline(page);
 const stages=page.locator('.pipeline-stage');await stages.nth(0).focus();await page.keyboard.press('ArrowRight');
 await expect(stages.nth(1)).toBeFocused();await expect(stages.nth(1)).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('End');await expect(stages.nth(7)).toBeFocused();
 await page.keyboard.press('Home');await expect(stages.nth(0)).toBeFocused();
 expect(await stages.nth(0).evaluate(el=>getComputedStyle(el,'::after').animationName)).toBe('none');
 expect(await page.locator('#pipeline-detail').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 const disclosure=page.locator('.pipeline-technical');await expect(disclosure).not.toHaveAttribute('open','');
 await disclosure.locator('summary').focus();await page.keyboard.press('Enter');await expect(disclosure).toHaveAttribute('open','');
 await expect(disclosure.locator('pre').first()).toContainText('calculation_method');
 await page.keyboard.press('Enter');await expect(disclosure).not.toHaveAttribute('open','');
});

test('switching keeps the selected stage; desktop and mobile layouts do not overflow',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await openPipeline(page);
 await page.locator('.pipeline-stage').nth(5).click();
 await page.screenshot({path:'../.local/pipeline/customer-desktop.png',fullPage:true});
 await page.getByRole('combobox',{name:'Banking workspace domain'}).selectOption('CARDS');
 await expect(page.getByTestId('pipeline-fingerprints')).toHaveText('164');
 await expect(page.locator('.pipeline-stage').nth(5)).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'../.local/pipeline/cards-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 for(const domain of ['CARDS','CUSTOMER_LENDING']){
  await page.getByRole('combobox',{name:'Banking workspace domain'}).selectOption(domain);
  await expect(page.getByTestId('pipeline-fingerprints')).toHaveText(domain==='CARDS'?'164':'130');
  await page.locator('.pipeline-stage').nth(2).click();
  expect(await page.locator('.pipeline-stages').evaluate(el=>getComputedStyle(el).display)).toBe('block');
  const detail=await page.locator('#pipeline-detail').boundingBox(),next=await page.locator('.pipeline-stage').nth(3).boundingBox();
  expect(detail.y+detail.height).toBeLessThanOrEqual(next.y);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.screenshot({path:`../.local/pipeline/${domain==='CARDS'?'cards':'customer'}-mobile.png`,fullPage:true});
 }
});
