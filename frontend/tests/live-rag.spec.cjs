const {test,expect}=require('@playwright/test');
test('remote RAG health explanation explicitly references the retrieved rule',async({page,request})=>{
 test.skip(process.env.LLM_LIVE!=='1'&&!process.env.LLM_RECORDED_RESULTS,'Remote-only inference');test.setTimeout(160000);
 const findings=await(await request.get('/api/findings')).json();const f=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');
 if(process.env.LLM_RECORDED_RESULTS){const recorded=require(require('path').resolve(process.env.LLM_RECORDED_RESULTS)).results.find(r=>r.name==='health');await page.route('**/api/findings/*',route=>route.fulfill({json:{...recorded.final,...f}}));}
 await page.goto('/');await page.locator('.pattern-button').filter({hasText:f.title}).click();
 const dialog=page.getByRole('dialog');
 await expect(dialog.locator('.context-used')).toContainText('BR-CUSTOMER-001');
 await expect(dialog.getByText('Local on-prem AI • Generated')).toBeVisible({timeout:145000});
 await expect(dialog.locator('.ai-explanation p')).toContainText('BR-CUSTOMER-001');
 await expect(dialog.locator('.ai-explanation p')).toContainText('2023');
 await page.setViewportSize({width:390,height:844});await dialog.locator('.context-used').scrollIntoViewIfNeeded();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await page.screenshot({path:'../.local/rag-live-mobile.png',fullPage:true});
});
