const {test,expect}=require('@playwright/test');
async function openBasics(page){
 await page.goto('/');await page.getByRole('button',{name:'Fingerprint Basics',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Fingerprint Basics',exact:true})).toBeVisible();
 await expect(page.locator('.basics-steps button')).toHaveCount(8);
}
for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`Basics explains all eight steps with saved ${domain} values`,async({page,request})=>{
 const cards=domain==='CARDS',suffix=cards?'?domain=CARDS':'';
 const overview=await(await request.get('/api/overview'+suffix)).json(),coverage=await(await request.get('/api/states/coverage'+suffix)).json();
 await page.addInitScript(domain=>localStorage.setItem('test-reality-domain',domain),domain);
 await openBasics(page);await expect(page.getByTestId('basics-metrics')).toHaveText(cards?'164 metrik':'130 metrik');
 await expect(page.locator('.basics-live-summary')).toContainText(cards?'61 finding':'31 finding');
 await expect(page.locator('.basics-live-summary')).toContainText(`${coverage.represented_in_test} / ${coverage.total_significant_prod_states}`);
 const calls=[];page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});
 const stages=page.locator('.basics-steps button'),detail=page.locator('#basics-detail');
 for(let i=0;i<8;i++){
  await stages.nth(i).click();await expect(stages.nth(i)).toHaveAttribute('aria-pressed','true');
  for(const label of ['WHAT HAPPENS HERE?','INPUT','OUTPUT','WHAT IS AUTOMATIC?','WHAT DOES THE USER CONFIGURE?','TECHNOLOGY'])await expect(detail.getByLabel(label,{exact:true})).toBeVisible();
  if(i===0)for(const env of overview.environments)await expect(detail.locator('.basics-sources')).toContainText(env);
  if(i===1)await expect(detail.locator('.basics-schema')).toContainText(cards?'CARD_STATUS_HISTORY':'CUSTOMER');
  if(i===2){await expect(detail.locator('.basics-scale')).toContainText('100,000,000');await expect(detail.locator('.basics-metric-stack')).toContainText(cards?'164':'130');}
  if(i===3){await expect(detail.locator('.basics-config-example')).toContainText(domain);await expect(detail.locator('.basics-config-example')).toContainText(cards?'available limit = 0':'active accounts = 0');}
  if(i===4)await expect(detail.locator('.basics-identity-stack')).toContainText(cards?'164':'130');
  if(i===5)for(const rate of cards?['20.36%','2.22%']:['32.47%','7.51%'])await expect(detail.locator('.basics-bars')).toContainText(rate);
  if(i===6){for(const value of [cards?'58 / 110':'44 / 70',cards?'872':'2,023',cards?'52':'26',cards?'61':'31'])await expect(detail.locator('.basics-finding-stats')).toContainText(value);await expect(detail.locator('.basics-finding-types span')).toHaveCount(4);}
  if(i===7){await expect(detail).toContainText(cards?'BR-CARD-001':'BR-CUSTOMER-001');await expect(detail).not.toContainText(cards?'BR-CUSTOMER-001':'BR-CARD-001');}
 }
 expect(calls).toEqual([]);
});

test('walkthrough supports play, pause, resume, stop, previous/next and manual selection without jobs',async({page})=>{
 await page.clock.install();await openBasics(page);const calls=[];page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.url());});
 const steps=page.locator('.basics-steps button'),progress=page.getByRole('progressbar',{name:'Walkthrough progress'});
 await page.getByRole('button',{name:'Play walkthrough'}).click();await page.clock.fastForward(2500);
 await expect(steps.nth(1)).toHaveAttribute('aria-pressed','true');await page.getByRole('button',{name:'Pause walkthrough'}).click();
 await page.clock.fastForward(10000);await expect(steps.nth(1)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Resume walkthrough'}).click();await page.clock.fastForward(2500);await expect(steps.nth(2)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Next step'}).click();await page.clock.fastForward(5000);await expect(steps.nth(3)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Previous step'}).click();await expect(steps.nth(2)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play walkthrough'}).click();await page.getByRole('button',{name:'Stop walkthrough',exact:true}).click();
 await expect(progress).toHaveAttribute('aria-valuenow','1');await page.clock.fastForward(5000);await expect(steps.nth(0)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play walkthrough'}).click();await steps.nth(5).click();await page.clock.fastForward(5000);await expect(steps.nth(5)).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Play walkthrough'}).click();
 for(let i=0;i<8;i++){await expect(steps.nth(i)).toHaveAttribute('aria-pressed','true');await expect(progress).toHaveAttribute('aria-valuenow',String(i+1));await page.clock.fastForward(2500);}
 await expect(page.getByRole('button',{name:'Play walkthrough'})).toBeVisible();await expect(page.getByRole('button',{name:'Next step'})).toBeDisabled();expect(calls).toEqual([]);
});

test('Business/Technical views share data and preserve workspace selection across refresh',async({page})=>{
 await openBasics(page);const basics=page.locator('.basics-page');await expect(basics.locator('pre')).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Business view',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Technical view',exact:true}).click();await expect(basics.locator('.basics-technical')).toContainText('SELECT status, COUNT(*)');
 await expect(basics.locator('.basics-technical')).toContainText('prod_snapshot');await expect(basics.locator('pre')).toHaveCount(3);
 await page.locator('.basics-steps button').nth(3).click();await page.getByRole('combobox',{name:'Banking workspace domain'}).selectOption('CARDS');
 await expect(page.getByTestId('basics-metrics')).toHaveText('164 metrik');await expect(page.locator('.basics-steps button').nth(3)).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.basics-technical')).toContainText('prod_cards');await expect(page.locator('.basics-technical')).toContainText('multi_active_card_rate');
 await page.reload();await expect(page.getByRole('combobox',{name:'Banking workspace domain'})).toHaveValue('CARDS');
 await page.getByRole('button',{name:'Fingerprint Basics',exact:true}).click();await expect(page.getByTestId('basics-metrics')).toHaveText('164 metrik');await expect(page.locator('.basics-page pre')).toHaveCount(0);
 await page.getByRole('button',{name:'Fingerprint Pipeline',exact:true}).click();await expect(page.locator('.pipeline-stage')).toHaveCount(8);await expect(page.getByTestId('pipeline-fingerprints')).toHaveText('164');
});

test('all technology help provides exactly three compact items, keyboard dismissal and hover',async({page})=>{
 await openBasics(page);const guide=page.locator('.basics-glossary');await guide.locator('summary').click();
 const names=['Oracle','PostgreSQL','Metadata queries','Aggregate SQL','Polars','DuckDB','Parquet','DataSketches','Sampling','RAG','LLM','Fingerprint','Domain Config','Comparison engine'];
 for(const name of names){
  const button=guide.getByRole('button',{name:`${name} hakkında`,exact:true});await button.focus();await page.keyboard.press('Enter');
  const popup=guide.getByRole('tooltip');await expect(popup).toBeVisible();await expect(popup.locator('dl>div')).toHaveCount(3);
  for(const title of ['WHAT IS IT?','WHERE DO WE USE IT?','WHY IS IT HERE?'])await expect(popup.getByText(title,{exact:true})).toBeVisible();
  await page.keyboard.press('Escape');await expect(button).toHaveAttribute('aria-expanded','false');await expect(guide.getByRole('tooltip')).toHaveCount(0);
 }
 const polars=guide.getByRole('button',{name:'Polars hakkında',exact:true});await polars.hover();await expect(guide.getByRole('tooltip')).toContainText('mevcut POC Polars bağımlılığını zaten kullanır');
 await page.mouse.move(0,0);await expect(guide.getByRole('tooltip')).toHaveCount(0);
});

test('reduced motion, arrow-key navigation and mobile views have no horizontal overflow',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:390,height:844});await openBasics(page);
 const steps=page.locator('.basics-steps button');await steps.nth(0).focus();await page.keyboard.press('ArrowRight');await expect(steps.nth(1)).toBeFocused();
 await page.keyboard.press('End');await expect(steps.nth(7)).toBeFocused();await page.keyboard.press('Home');await expect(steps.nth(0)).toBeFocused();
 expect(await page.locator('.basics-detail').evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
 for(const domain of ['CUSTOMER_LENDING','CARDS']){
  await page.getByRole('combobox',{name:'Banking workspace domain'}).selectOption(domain);await expect(page.getByTestId('basics-metrics')).toHaveText(domain==='CARDS'?'164 metrik':'130 metrik');
  for(let i=0;i<8;i++){await steps.nth(i).click();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);}
  await page.getByRole('button',{name:'Technical view',exact:true}).click();await expect(page.locator('.basics-technical')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await steps.nth(2).click();expect(await page.locator('.basics-raw-blocks i').first().evaluate(el=>getComputedStyle(el).animationName)).toBe('none');
  const help=page.getByLabel('TECHNOLOGY',{exact:true}).getByRole('button',{name:'DataSketches hakkında',exact:true});await help.focus();await page.keyboard.press('Enter');await expect(page.getByRole('tooltip')).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Business view',exact:true}).click();
 }
});
