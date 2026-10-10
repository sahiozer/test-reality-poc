const {test,expect}=require('@playwright/test');

for(const mode of ['GENERATED','FALLBACK']) {
  test(`finding explanation preserves immediate evidence then shows ${mode}`,async({page,request})=>{
    const findings=await(await request.get('/api/findings')).json();
    const f=findings.find(f=>f.finding_type==='MISSING_STATE');
    let requests=0;
    await page.route('**/api/findings/*',async route=>{
      requests++;
      await route.fulfill({json:{...f,deterministicSummary:'Kanıta dayalı özet.',aiExplanation:requests===1?'':'PROD ve TEST değerleri kanıttan alınmıştır.',aiExplanationStatus:requests===1?'PENDING':mode}});
    });
    if(mode==='FALLBACK')await page.setViewportSize({width:390,height:844});
    await page.goto('/');
    await page.getByRole('button',{name:'Missing states',exact:true}).click();
    await page.locator('.pattern-button').filter({hasText:f.title}).click();
    const dialog=page.getByRole('dialog');
    await expect(dialog.locator('pre').first()).toContainText('"test_count": 0');
    await expect(dialog.getByText('Local on-prem AI explanation is being generated…')).toBeVisible();
    await expect(dialog.getByText(mode==='GENERATED'?'Local on-prem model':'Template fallback')).toBeVisible({timeout:10000});
    await expect(dialog.getByText('PROD ve TEST değerleri kanıttan alınmıştır.')).toBeVisible();
    await expect(dialog.locator('pre').first()).toContainText(String(f.evidence.prod_count));
    expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    if(mode==='FALLBACK')await page.screenshot({path:'../.local/explanation-mobile-fallback.png',fullPage:true});
  });
}

test('detail explanation transport failure falls back while evidence stays usable',async({page,request})=>{
  const findings=await(await request.get('/api/findings')).json();const f=findings[0];
  await page.route('**/api/findings/*',route=>route.abort('failed'));
  await page.goto('/');await page.locator('.pattern-button').filter({hasText:f.title}).click();
  await expect(page.getByRole('dialog').getByText('Template fallback')).toBeVisible();
  await expect(page.getByRole('dialog').locator('pre').first()).toContainText(f.evidence.calculation_method);
  await page.getByRole('button',{name:'Close finding'}).click();
  await expect(page.getByRole('button',{name:'Run analysis',exact:true})).toBeEnabled();
});
