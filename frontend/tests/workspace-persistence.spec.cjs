const {test,expect}=require('@playwright/test');
const key='test-reality-domain';
for(const width of [1440,390]){
 test(`workspace survives refresh with immediate storage updates at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:844});
  await page.goto('/');
  const selector=page.getByRole('combobox',{name:'Banking workspace domain'});
  for(const domain of ['CARDS','CUSTOMER_LENDING']){
   await expect(selector.locator(`option[value="${domain}"]`)).toHaveCount(1);
   // Read storage in the same JS turn, before React effects can run.
   const stored=await selector.evaluate((element,{domain,key})=>{
    element.value=domain;element.dispatchEvent(new Event('change',{bubbles:true}));
    return localStorage.getItem(key);
   },{domain,key});
   expect(stored).toBe(domain);
   await page.reload();await expect(selector).toHaveValue(domain);
   await expect(page.locator('.environment-strip')).toContainText(domain==='CARDS'?'prod_cards':'prod_snapshot');
   await expect(page.locator('.metric-value')).toHaveCount(4);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
 });
}
for(const stored of ['CARDS','CUSTOMER_LENDING','INVALID','cards','']){
 test(`startup validates persisted workspace ${JSON.stringify(stored)}`,async({page})=>{
  await page.addInitScript(({key,stored})=>localStorage.setItem(key,stored),{key,stored});
  const overviewRequests=[];page.on('request',request=>{if(request.url().includes('/api/overview'))overviewRequests.push(request.url());});
  await page.goto('/');
  const expected=stored==='CARDS'?'CARDS':'CUSTOMER_LENDING';
  await expect(page.getByRole('combobox',{name:'Banking workspace domain'})).toHaveValue(expected);
  await expect(page.locator('.metric-value')).toHaveCount(4);
  expect(overviewRequests.length).toBeGreaterThan(0);
  for(const url of overviewRequests)expect(new URL(url).searchParams.get('domain')).toBe(expected==='CARDS'?'CARDS':null);
 });
}
