const {test,expect}=require('@playwright/test');
for(const status of ['GENERATED','FALLBACK'])test(`async ${status}: context is immediate and polling stops at completion`,async({page,request})=>{
 test.setTimeout(20000);
 const findings=await(await request.get('/api/findings')).json();const f=findings.find(f=>f.finding_type==='DATA_HEALTH_ISSUE');
 let count=0;await page.route('**/api/findings/*',route=>{
  count++;return route.fulfill({json:{...f,deterministicSummary:f.explanation,aiExplanationStatus:count===1?'PENDING':status,aiExplanation:count===1?'':'Grounded result',retrievedContext:[{id:'BR-CUSTOMER-001',title:'BR-CUSTOMER-001',sourceType:'BUSINESS_RULE',content:'Kapalı müşterilerin aktif hesabı bulunmamalıdır.',relevanceScore:1}]}});
 });
 await page.goto('/');await page.locator('.pattern-button').filter({hasText:f.title}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.locator('.context-used')).toContainText('BR-CUSTOMER-001');
 await expect(dialog.getByText('Local on-prem AI explanation is being generated…')).toBeVisible();
 await expect(dialog.locator('.ai-explanation')).toContainText('Grounded result',{timeout:10000});
 const finished=count;await page.waitForTimeout(4500);expect(count).toBe(finished);expect(count).toBe(2);
});
test('closing pending detail cancels its polling loop',async({page,request})=>{
 const f=(await(await request.get('/api/findings')).json())[0];let count=0;
 await page.route('**/api/findings/*',route=>{count++;return route.fulfill({json:{...f,deterministicSummary:f.explanation,aiExplanation:'',aiExplanationStatus:'PENDING',retrievedContext:[]}});});
 await page.goto('/');await page.locator('.pattern-button').filter({hasText:f.title}).click();
 await expect(page.getByRole('dialog').getByText('Local on-prem AI explanation is being generated…')).toBeVisible();
 await expect.poll(()=>count).toBe(1);await page.getByRole('button',{name:'Close finding'}).click();
 await page.waitForTimeout(4500);expect(count).toBe(1);await expect(page.getByRole('dialog')).toHaveCount(0);
});
