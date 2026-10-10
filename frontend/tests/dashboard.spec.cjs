const { test, expect } = require('@playwright/test');

test('real dashboard renders persisted results and opens missing-state evidence', async ({page,request})=>{
  const overview=await (await request.get('/api/overview')).json();
  const coverage=await (await request.get('/api/states/coverage')).json();
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'See the gaps. Test with confidence.'})).toBeVisible();
  await expect(page.getByText('Analysis saved',{exact:true})).toBeVisible();
  await page.screenshot({path:'../.local/dashboard-desktop.png',fullPage:true});
  await expect(page.locator('.metric-card').nth(2).locator('.metric-value')).toHaveText(String(overview.missing_data_states));
  await page.getByRole('button',{name:'Missing states',exact:true}).click();
  await page.locator('.pattern-button').first().click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').locator('.technical-evidence')).not.toHaveAttribute('open','');
  await page.getByRole('dialog').locator('.technical-evidence summary').click();
  await expect(page.getByRole('dialog').locator('pre').first()).toContainText('"test_count": 0');
  await page.getByRole('button',{name:'Close finding'}).click();
  await page.getByRole('button',{name:'State coverage',exact:true}).click();
  await expect(page.getByRole('heading',{name:`${coverage.represented_in_test} / ${coverage.total_significant_prod_states} states represented`})).toBeVisible();
  await page.getByRole('button',{name:'Fingerprints',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Environment fingerprints'})).toBeVisible();
  expect(errors).toEqual([]);
});

test('dashboard remains usable at a narrow viewport', async ({page,request})=>{
  const overview=await (await request.get('/api/overview')).json();
  await page.setViewportSize({width:390,height:844});
  await page.goto('/');
  await expect(page.getByRole('button',{name:'Run analysis',exact:true})).toBeVisible();
  // The compact status badge is intentionally hidden. Persisted results and the
  // visible timestamp provide completion feedback after loading or refreshing.
  await expect(page.locator('.metric-card').nth(2).locator('.metric-value')).toHaveText(String(overview.missing_data_states));
  const savedFeedback=page.locator('.page-footer').getByText(/^Last analysis:/);
  await savedFeedback.scrollIntoViewIfNeeded();
  await expect(savedFeedback).toBeVisible();
  const expectedTimestamp=await page.evaluate(iso=>new Date(iso).toLocaleString(),overview.generated_at);
  await expect(savedFeedback).toContainText(expectedTimestamp);
  await page.screenshot({path:'../.local/dashboard-mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  expect(overflow).toBe(false);
});

test('executive flow runs analysis, exposes all evidence, and survives refresh', async ({page,request})=>{
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.locator('.page-footer')).toContainText('Last analysis:');
  const before=await (await request.get('/api/overview')).json();
  const complete=page.waitForResponse(r=>r.url().endsWith('/api/analysis/run')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Run analysis',exact:true}).click();
  const response=await complete;
  expect(response.ok()).toBe(true);
  const snapshot=await response.json();
  expect(snapshot.run_id).not.toBe(before.run_id);
  await expect(page.getByRole('status')).toContainText('Analysis complete');
  const findings=snapshot.findings;
  for (const type of ['REPRESENTATION_GAP','DATA_HEALTH_ISSUE','FRESHNESS_GAP']) {
    const finding=findings.find(f=>f.finding_type===type);
    expect(finding).toBeTruthy();
    await page.locator('.pattern-button').filter({hasText:finding.title}).click();
    await page.getByRole('dialog').locator('.technical-evidence summary').click();
    await expect(page.getByRole('dialog').locator('pre').first()).toContainText(finding.evidence.calculation_method);
    await page.getByRole('button',{name:'Close finding'}).click();
  }
  await page.getByRole('button',{name:'State coverage',exact:true}).click();
  const c=snapshot.coverage;
  await expect(page.getByRole('heading',{name:`${c.represented_in_test} / ${c.total_significant_prod_states} states represented`})).toBeVisible();
  await page.getByRole('combobox',{name:'Filter states'}).selectOption('MISSING');
  await expect(page.locator('tbody tr')).toHaveCount(c.missing_in_test);
  await page.locator('.state-link').first().click();
  await page.getByRole('dialog').locator('.technical-evidence summary').click();
  await expect(page.getByRole('dialog').locator('pre').first()).toContainText('"test_count": 0');
  await page.getByRole('button',{name:'Close finding'}).click();
  await page.reload();
  await expect(page.locator('.metric-card').nth(2).locator('.metric-value')).toHaveText(String(c.missing_in_test));
  const after=await (await request.get('/api/overview')).json();
  expect(after.run_id).toBe(snapshot.run_id);
  expect(after.business_metrics).toEqual(before.business_metrics);
  expect(after.freshness.age_difference_days).toBe(before.freshness.age_difference_days);
});
