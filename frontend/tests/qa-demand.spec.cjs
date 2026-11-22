const {test,expect}=require('@playwright/test');
for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`count demand triage, generic repair and exclusions: ${domain}`,async({page,request})=>{
 test.skip(process.env.LOCAL_REPAIR_SMOKE!=='1','Local demand feature only');
 const response=await request.get('/api/test-demand/findings?domain='+domain);expect(response.ok()).toBe(true);const entries=await response.json();
 const d=entries.find(e=>e.metric_key?.startsWith('state:')&&e.required===null);expect(d).toBeTruthy();
 await page.addInitScript(d=>localStorage.setItem('test-reality-domain',d),domain);await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();
 let row=page.locator('tbody tr').filter({has:page.locator('.pattern-button').filter({hasText:d.finding.title})});await expect(row.locator('.qa-badge')).toHaveText('Needs QA Review');await row.locator('.pattern-button').click();
 const panel=page.getByRole('region',{name:'TEST DEMAND & REPAIR'});await expect(panel).toContainText('Defined by QA');await expect(panel.locator('[data-qa-status]')).toHaveText('Needs QA Review');await expect(panel).toContainText('Not evaluated');await expect(panel.locator('.qa-evidence-pair>div')).toHaveCount(2);
 await panel.getByLabel('Required for regression',{exact:true}).fill(String(d.usable+3));await panel.getByRole('button',{name:'Save requirement'}).click();await expect(panel).toContainText('3 Needed');if(d.capability==='POPULATION_REPAIR_AUTOMATED'){await expect(panel.getByRole('button',{name:'Preview Repair'})).toBeVisible();}else{await expect(panel).toContainText(d.unsupported_reason);await expect(panel.getByRole('button',{name:'Preview Repair'})).toHaveCount(0);}
 await page.getByRole('button',{name:'Close finding'}).click();await expect(row.locator('.qa-badge')).toHaveText('3 Needed');await expect(row.locator('.qa-list-cell small')).toContainText('Needed 3');
 await row.locator('.pattern-button').click();await panel.getByLabel('Required for regression',{exact:true}).fill('0');await panel.getByRole('button',{name:'Save requirement'}).click();await expect(panel.locator('[data-qa-status]')).toContainText('QA Need Met');await page.getByRole('button',{name:'Close finding'}).click();await expect(row.locator('.qa-badge')).toHaveClass(/qa-met/);
 await page.reload();await page.getByRole('button',{name:'Findings',exact:false}).first().click();await row.locator('.pattern-button').click();await expect(panel.getByLabel('Required for regression',{exact:true})).toHaveValue('0');await page.getByRole('button',{name:'Close finding'}).click();
 for(const type of ['DATA_HEALTH_ISSUE','FRESHNESS_GAP']){const excluded=entries.find(e=>e.finding.finding_type===type);expect(excluded.demandCapability).toBe('NONE');await page.locator('.pattern-button').filter({hasText:excluded.finding.title}).click();await expect(page.getByRole('region',{name:'TEST DEMAND & REPAIR'})).toHaveCount(0);await page.getByRole('button',{name:'Close finding'}).click();}
});

test('late demand response cannot leak a previous workspace into the list',async({page,request})=>{
 test.skip(process.env.LOCAL_REPAIR_SMOKE!=='1','Local demand feature only');
 const entries=await(await request.get('/api/test-demand/findings')).json(),d=entries.find(e=>e.metric_key?.startsWith('state:'));
 let seen=0,release;const gate=new Promise(r=>release=r);let arrived;const held=new Promise(r=>arrived=r);
 await page.route('**/api/test-demand/findings',async route=>{seen++;if(seen===2){arrived();await gate;await route.fulfill({json:entries});}else await route.continue();});
 await page.addInitScript(()=>localStorage.setItem('test-reality-domain','CUSTOMER_LENDING'));await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();await page.locator('.pattern-button').filter({hasText:d.finding.title}).click();
 const panel=page.getByRole('region',{name:'TEST DEMAND & REPAIR'});await panel.getByLabel('Required for regression',{exact:true}).fill(String(d.required??0));await panel.getByRole('button',{name:'Save requirement'}).click();await held;await page.getByRole('button',{name:'Close finding'}).click();await page.getByRole('combobox',{name:'Banking workspace domain'}).selectOption('CARDS');
 await expect(page.locator('.pattern-button').filter({hasText:'Active credit cards with available limit from multi-card customers'})).toBeVisible();const completed=page.waitForResponse(r=>r.url().endsWith('/api/test-demand/findings'));release();await completed;await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await expect(page.locator('.pattern-button').filter({hasText:'At least two active accounts and at least one blocked account'})).toHaveCount(0);
});
