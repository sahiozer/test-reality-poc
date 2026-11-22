const {test,expect}=require('@playwright/test');
const path=require('path');
const out=path.resolve(__dirname,'../../.local/generic-repair');
for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`generic population: three distinct additional findings ${domain}`,async({page,request})=>{
 test.skip(process.env.GENERIC_REPAIR_SMOKE!=='1','Disposable local stack only');test.setTimeout(360000);
 const read=async()=>{const r=await request.get('/api/test-demand/findings?domain='+domain);expect(r.ok()).toBe(true);return r.json();};
 const entries=await read();const states=entries.filter(e=>e.metric_key?.startsWith('state:')&&e.capability==='POPULATION_REPAIR_AUTOMATED');
 expect(states.length).toBeGreaterThan(2);
 const first=states[0],second=states.find(s=>domain==='CUSTOMER_LENDING'?s.predicate.conditions.some(c=>c.feature==='active_loan_count'&&c.value===1)&&s.predicate.conditions.some(c=>c.feature==='active_card_count'&&c.value===1):s.predicate.conditions.some(c=>c.feature==='card_status'&&c.value!=='ACTIVE')&&s.predicate.conditions.some(c=>c.feature==='has_physical_and_virtual'&&c.value));
 expect(second).toBeTruthy();expect(second.metric_key).not.toBe(first.metric_key);
 const headline=entries.find(e=>e.metric_key===(domain==='CARDS'?'multi_active_card_rate':'multi_account_rate'));
 await page.addInitScript(d=>localStorage.setItem('test-reality-domain',d),domain);
 for(const chosen of [headline,first,second]){
  // Re-read because other repairs can affect a predicate with broader scope.
  const d=(await read()).find(e=>e.metric_key===chosen.metric_key);expect(d).toBeTruthy();
  await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();
  await page.locator('.pattern-button').filter({hasText:d.finding.title}).click();
  const panel=page.getByRole('region',{name:'TEST DEMAND & REPAIR'});
  await panel.getByLabel('Required for regression',{exact:true}).fill(String(d.usable+2));await panel.getByRole('button',{name:'Save requirement'}).click();await expect(panel).toContainText('2 Needed');
  await panel.getByRole('button',{name:'Preview Repair',exact:true}).click();await expect(panel.locator('.repair-plan')).toContainText('2 qualifying business states');await expect(panel.locator('.repair-plan')).toContainText('physical rows');
  await panel.locator('.repair-plan summary').click();await expect(panel.locator('pre')).toContainText('INSERT INTO '+(domain==='CARDS'?'test_cards.':'test_env.'));await expect(panel.locator('pre')).toContainText('%(v0)s');
  await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Repair Gap (+2)',exact:true}).click();await expect(panel.locator('[data-qa-status]')).toHaveText('Repair Pending Verification');
  await panel.getByRole('button',{name:'Re-run Analysis',exact:true}).click();await expect(panel.locator('[data-qa-status]')).toContainText('Repair Verified',{timeout:120000});await expect(panel).toContainText(`After: ${d.usable+2} / ${d.usable+2}`);const verified=(await read()).find(e=>e.metric_key===d.metric_key);expect(verified.qa_status).toBe('REPAIR_VERIFIED');expect(verified.finding.finding_id).not.toBe(d.finding.finding_id);if(d.metric_key.startsWith('state:')&&d.usable===0){expect(d.finding.finding_type).toBe('MISSING_STATE');expect(verified.finding.finding_type).not.toBe('MISSING_STATE');}
  await page.getByRole('button',{name:'Close finding'}).click();await page.reload();await page.getByRole('button',{name:'Findings',exact:false}).first().click();const row=page.locator('tbody tr').filter({has:page.locator('.pattern-button').filter({hasText:d.finding.title})});await expect(row.locator('.qa-badge')).toHaveText('✓ Repair Verified');await row.locator('.pattern-button').click();
  await page.screenshot({path:path.join(out,`${domain}-${chosen.metric_key.replace(':','-')}-desktop.png`),animations:'disabled'});
  await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:path.join(out,`${domain}-${chosen.metric_key.replace(':','-')}-mobile.png`),animations:'disabled'});await page.setViewportSize({width:1280,height:900});
  await panel.locator('.demand-lab summary').click();await panel.getByLabel('Qualifying states to remove').fill('2');await panel.getByRole('button',{name:'Inject Gap',exact:true}).click();await expect(panel).toContainText('Demo gap injected');await panel.getByRole('button',{name:'Re-run Analysis',exact:true}).click();await expect(panel.locator('[data-qa-status]')).toContainText('2 Needed',{timeout:120000});
 }
});
for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`approved health correction and guidance ${domain}`,async({page,request})=>{
 test.skip(process.env.GENERIC_HEALTH_SMOKE!=='1','Disposable seeded TEST rows only');test.setTimeout(180000);
 const entries=await(await request.get('/api/test-demand/findings?domain='+domain)).json(),d=entries.find(e=>e.capability==='HEALTH_REPAIR_AUTOMATED');expect(d).toBeTruthy();expect(d.violations).toBeGreaterThan(0);
 await page.addInitScript(d=>localStorage.setItem('test-reality-domain',d),domain);await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();await page.locator('.pattern-button').filter({hasText:d.finding.title}).click();
 const panel=page.getByRole('region',{name:'DATA HEALTH & REPAIR'});await expect(panel).toContainText('Allowed violations');await expect(panel).toContainText(d.policy.description);await expect(page.getByRole('region',{name:'TEST DEMAND & REPAIR'})).toHaveCount(0);await expect(page.getByLabel('Required for regression',{exact:true})).toHaveCount(0);
 await panel.getByRole('button',{name:'Preview Repair',exact:true}).click();await expect(panel.locator('.repair-plan')).toContainText(`${d.violations} affected business entities`);await panel.locator('summary').click();await expect(panel.locator('pre')).toContainText('UPDATE '+(domain==='CARDS'?'test_cards.card_limit':'test_env.account'));
 await expect(panel.getByRole('button',{name:'Apply Health Repair'})).toBeDisabled();await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Apply Health Repair'}).click();await expect(panel.locator('[data-health-status]')).toHaveText('Repair Pending Verification');
 await panel.getByRole('button',{name:'Re-run Analysis',exact:true}).click();await expect(panel).toContainText('DATA HEALTH VERIFIED',{timeout:120000});await expect(panel.locator('[data-health-status]')).toHaveText('Health Verified');
 await page.getByRole('button',{name:'Close finding'}).click();await page.reload();await page.getByRole('button',{name:'Findings',exact:false}).first().click();await page.getByRole('button',{name:'Health',exact:true}).click();await page.locator('.pattern-button').filter({hasText:d.label}).click();await expect(panel.locator('[data-health-status]')).toHaveText('Health Verified');
 await page.screenshot({path:path.join(out,`${domain}-health-desktop.png`),animations:'disabled'});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.screenshot({path:path.join(out,`${domain}-health-mobile.png`),animations:'disabled'});
 await page.getByRole('button',{name:'Close finding'}).click();await page.getByRole('button',{name:'All findings',exact:true}).click();const freshness=entries.find(e=>e.finding.finding_type==='FRESHNESS_GAP');await page.locator('.pattern-button').filter({hasText:freshness.finding.title}).click();const guide=page.getByLabel('Freshness resolution');await expect(guide).toContainText('Refresh / reprovision TEST source');await expect(guide.getByRole('button')).toHaveCount(0);
});

test('unsupported population feature remains demand-only with its exact reason',async({page,request})=>{
 test.skip(process.env.GENERIC_REPAIR_SMOKE!=='1','Local repair UI fixture');
 const entries=await(await request.get('/api/test-demand/findings')).json();const original=entries.find(e=>e.metric_key?.startsWith('state:'));
 const d={...original,repairCapability:'NOT_AVAILABLE',capability:'POPULATION_REPAIR_UNSUPPORTED',unsupported_reason:'Unsupported canonical feature: future_relationship_count',required:null,needed:null,qa_status:'NEEDS_QA_REVIEW'};
 await page.route('**/api/test-demand/findings*',route=>route.fulfill({json:entries.map(e=>e.metric_key===d.metric_key?d:e)}));
 await page.route('**/api/test-demand?*',route=>route.fulfill({json:d}));
 await page.route('**/api/test-demand/save',route=>{const b=route.request().postDataJSON();d.required=b.required;d.needed=Math.max(b.required-d.usable,0);d.qa_status='INSUFFICIENT';return route.fulfill({json:d});});
 await page.addInitScript(()=>localStorage.setItem('test-reality-domain','CUSTOMER_LENDING'));await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();await page.locator('.pattern-button').filter({hasText:d.finding.title}).click();
 const panel=page.getByRole('region',{name:'TEST DEMAND & REPAIR'});await expect(panel).toContainText(d.unsupported_reason);await panel.getByLabel('Required for regression',{exact:true}).fill(String(d.usable+3));await panel.getByRole('button',{name:'Save requirement'}).click();await expect(panel).toContainText('3 Needed');await expect(panel.getByRole('button',{name:'Preview Repair'})).toHaveCount(0);await expect(panel.getByText('Preview SQL',{exact:true})).toHaveCount(0);
});
test('health without an approved policy offers guided resolution without QA demand',async({page,request})=>{
 test.skip(process.env.GENERIC_REPAIR_SMOKE!=='1','Local repair UI fixture');
 const entries=await(await request.get('/api/test-demand/findings')).json(),original=entries.find(e=>e.health_status);expect(original).toBeTruthy();
 const d={...original,policy:null,capability:'HEALTH_REPAIR_GUIDED',repairCapability:'NOT_AVAILABLE',health_status:'HEALTH_REVIEW'};
 await page.route('**/api/test-demand/findings*',route=>route.fulfill({json:entries.map(e=>e.metric_key===d.metric_key?d:e)}));
 await page.addInitScript(()=>localStorage.setItem('test-reality-domain','CUSTOMER_LENDING'));await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();await page.locator('.pattern-button').filter({hasText:d.finding.title}).click();
 const panel=page.getByRole('region',{name:'DATA HEALTH & REPAIR'});await expect(panel).toContainText('No automated correction policy');await expect(panel.getByRole('button',{name:'Preview Repair'})).toHaveCount(0);await expect(page.getByRole('region',{name:'TEST DEMAND & REPAIR'})).toHaveCount(0);
});
