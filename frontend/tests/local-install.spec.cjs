const {test,expect}=require('@playwright/test');
for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`clean local core install: ${domain} navigation, evidence and fallback`,async({page,request})=>{
 test.skip(process.env.LOCAL_INSTALL_SMOKE!=='1','Opt-in check against a seeded root local stack with LLM_ENABLED=false');
 const errors=[],badAPI=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.url().includes('/api/')&&r.status()>=400)badAPI.push([r.url(),r.status()]);});
 await page.addInitScript(domain=>localStorage.setItem('test-reality-domain',domain),domain);await page.goto('/');
 const selector=page.getByRole('combobox',{name:'Banking workspace domain'}),cards=domain==='CARDS';await expect(selector).toHaveValue(domain);
 const suffix='?domain='+domain,overview=await(await request.get('/api/overview'+suffix)).json();
 await expect(page.locator('.metric-card').nth(2).locator('.metric-value')).toHaveText(String(overview.missing_data_states));
 const nav=[['Findings','Every finding, backed by evidence.'],['State coverage',cards?'58 / 110 states represented':'44 / 70 states represented'],['Fingerprints','Environment fingerprints'],['Fingerprint Basics','Fingerprint Basics'],['Fingerprint Pipeline','Fingerprint Pipeline']];
 for(const [name,heading] of nav){await page.getByRole('button',{name,exact:name!=='Findings'}).first().click();await expect(page.getByRole('heading',{name:heading,exact:true})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);}
 await page.getByRole('button',{name:'Findings',exact:false}).first().click();
 const findings=await(await request.get('/api/findings'+suffix)).json(),health=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');await page.locator('.pattern-button').filter({hasText:health.title}).click();
 const detail=page.getByRole('dialog');await expect(detail.locator('.context-used')).toContainText(cards?'BR-CARD-001':'BR-CUSTOMER-001');await expect(detail.locator('.ai-status')).toHaveAttribute('data-status','FALLBACK');
 await detail.locator('.technical-evidence summary').click();await expect(detail.locator('pre').first()).toContainText(health.evidence.calculation_method);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);await page.getByRole('button',{name:'Close finding'}).click();await page.reload();await expect(selector).toHaveValue(domain);await expect(page.locator('.metric-card').nth(2).locator('.metric-value')).toHaveText(String(overview.missing_data_states));expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 expect(errors).toEqual([]);expect(badAPI).toEqual([]);
});
