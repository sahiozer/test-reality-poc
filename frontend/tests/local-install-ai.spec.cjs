const {test,expect}=require('@playwright/test');
test('local CPU AI keeps navigation usable while pending and reuses the saved explanation',async({page,request})=>{
 test.skip(process.env.LOCAL_INSTALL_AI!=='1','Opt-in root local AI profile with qwen2.5:0.5b and a fresh Cards explanation cache');test.setTimeout(160000);
 const findings=await(await request.get('/api/findings?domain=CARDS')).json(),health=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');
 await page.addInitScript(()=>localStorage.setItem('test-reality-domain','CARDS'));await page.goto('/');await page.getByRole('button',{name:'Findings',exact:false}).first().click();
 const received=page.waitForResponse(r=>r.url().includes('/api/findings/')&&r.request().method()==='GET');await page.locator('.pattern-button').filter({hasText:health.title}).click();const initial=await(await received).json();
 expect(initial.aiExplanationStatus).toBe('PENDING');expect(initial.retrievedContext.length).toBeGreaterThan(0);await expect(page.getByRole('dialog').locator('.context-used')).toContainText('BR-CARD-001');
 await page.getByRole('button',{name:'Close finding'}).click();await page.getByRole('button',{name:'Fingerprint Basics',exact:true}).click();await expect(page.getByTestId('basics-metrics')).toHaveText('164 metrik');
 expect((await request.get('/api/overview?domain=CARDS')).ok()).toBe(true);
 await page.getByRole('button',{name:'Findings',exact:false}).first().click();await page.locator('.pattern-button').filter({hasText:health.title}).click();await expect(page.getByRole('dialog').locator('.ai-status')).toHaveAttribute('data-status','GENERATED',{timeout:145000});
 const url='/api/findings/'+encodeURIComponent(health.finding_id)+'?domain=CARDS';const a=await(await request.get(url)).json(),b=await(await request.get(url)).json();expect(a.explanationCacheKey).toBe(initial.explanationCacheKey);expect(b.aiExplanation).toBe(a.aiExplanation);expect(b.aiExplanationStatus).toBe('GENERATED');
});
