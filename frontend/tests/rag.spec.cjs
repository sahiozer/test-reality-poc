const {test,expect}=require('@playwright/test');

test('health detail shows retrieved demo business rule and preserves original evidence',async({page,request})=>{
 const findings=await(await request.get('/api/findings')).json();const f=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');
 const detail=await(await request.get(`/api/findings/${encodeURIComponent(f.finding_id)}`)).json();
 expect(detail.retrievedContext[0].id).toBe('BR-CUSTOMER-001');expect(detail.contextUsed).toBe(true);
 for(const key of Object.keys(f))expect(detail[key]).toEqual(f[key]);
 await page.goto('/');await page.locator('.pattern-button').filter({hasText:f.title}).click();
 const section=page.getByRole('dialog').locator('.context-used');
 await expect(section.getByRole('heading',{name:'Context used',exact:true})).toBeVisible();
 await expect(section.getByText('Closed customer / active account',{exact:true})).toBeVisible();
 await expect(section.getByText('BUSINESS RULE',{exact:true})).toBeVisible();
 await page.screenshot({path:'../.local/rag-context-desktop.png',fullPage:true});
});

test('mobile representation context contains definitions and never attaches a business rule',async({page,request})=>{
 const findings=await(await request.get('/api/findings')).json();const f=findings.find(f=>f.evidence.metric==='multi_account_rate');
 const detail=await(await request.get(`/api/findings/${encodeURIComponent(f.finding_id)}`)).json();
 expect(detail.retrievedContext[0].id).toBe('REPRESENTATION_GAP');
 expect(detail.retrievedContext.some(c=>c.sourceType==='BUSINESS_RULE')).toBe(false);
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.locator('.pattern-button').filter({hasText:f.title}).click();
 const section=page.getByRole('dialog').locator('.context-used');await section.scrollIntoViewIfNeeded();
 await expect(section.getByText('Representation gap',{exact:true})).toBeVisible();
 await expect(section.getByText('BUSINESS RULE',{exact:true})).toHaveCount(0);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'../.local/rag-context-mobile.png',fullPage:true});
});
