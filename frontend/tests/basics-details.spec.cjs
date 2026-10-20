const {test,expect}=require('@playwright/test');
const title='Bu adım gerçekte nasıl çalışıyor?';
const headings=['Bu adımda ne yapıyoruz?','Gerçekte sistem ne yapıyor?','Basit örnek','Örnek sorgu / config','Ne otomatik?','Kullanıcı ne ayarlar?','Çıktı ne?','Hangi teknoloji burada ve neden?'];
async function open(page,domain='CUSTOMER_LENDING'){
 await page.addInitScript(domain=>localStorage.setItem('test-reality-domain',domain),domain);
 await page.goto('/');await page.getByRole('button',{name:'Fingerprint Basics',exact:true}).click();
 await expect(page.getByTestId('basics-metrics')).toHaveText(domain==='CARDS'?'164 metrik':'130 metrik');
}
for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`all eight detailed steps use saved ${domain} data and stay read-only`,async({page,request})=>{
 const cards=domain==='CARDS',query='?domain='+domain,metric=cards?'multi_active_card_rate':'multi_account_rate';
 const fingerprints=await(await request.get('/api/fingerprints'+query)).json(),findings=await(await request.get('/api/findings'+query)).json();
 await open(page,domain);const calls=[];page.on('request',r=>{if(r.url().includes('/api/'))calls.push(r.method()+' '+r.url());});
 const steps=page.locator('.basics-steps button'),panel=page.locator('.basics-how');
 for(let i=0;i<8;i++){
  await steps.nth(i).click();await expect(panel).toHaveCount(1);expect(await panel.evaluate(el=>el.open)).toBe(false);
  await expect(panel.locator('.basics-how-body')).toHaveCount(0);await panel.locator('summary').click();
  for(const heading of headings)await expect(panel.getByRole('heading',{name:heading,exact:false})).toBeVisible();
  await expect(panel.locator('pre')).toHaveCount(1);await expect(panel.locator('script,iframe,form')).toHaveCount(0);
  if(i===0){await expect(panel).toContainText(cards?'prod_cards → test_cards':'prod_snapshot → test_env');await expect(panel).toContainText('kimlik bilgisi içermez');}
  if(i===1){await expect(panel.locator('code')).toContainText("SELECT table_name\nFROM all_tables\nWHERE owner = 'APP_SCHEMA';");await expect(panel).toContainText('POC otomatik keşif yerine');}
  if(i===2){await expect(panel).toContainText('Varsayımsal çıktı (canlı metrik değil)');await expect(panel).toContainText('100,000,000');await expect(panel).toContainText('Nadir/kritik durumlar sample’a bırakılmaz');await expect(panel.locator('.basics-how-tools article')).toHaveCount(6);}
  if(i===3){await expect(panel).toContainText('SQL generic mi? Çekirdek motor generic.');await expect(panel).toContainText(cards?'BR-CARD-001':'BR-CUSTOMER-001');}
  if(i===4){const record=JSON.parse(await panel.locator('code').innerText());expect(record).toEqual(fingerprints.find(f=>f.metric_name===metric&&f.environment===(cards?'prod_cards':'prod_snapshot')));}
  if(i===5)for(const value of cards?['20.36%','2.22%','18.14 yüzde puan']:['32.47%','7.51%','24.96 yüzde puan'])await expect(panel).toContainText(value);
  if(i===6){const finding=findings.find(f=>f.finding_type==='REPRESENTATION_GAP'&&f.evidence.metric===metric),shown=JSON.parse(await panel.locator('code').innerText());expect(shown).toEqual({finding_type:finding.finding_type,metric,prod_value:finding.prod_value,test_value:finding.test_value,assessment:finding.assessment});for(const value of cards?['61 findings','58/110','872']:['31 findings','44/70','2,023'])await expect(panel).toContainText(value);}
  if(i===7){await expect(panel).toContainText(cards?'BR-CARD-001':'BR-CUSTOMER-001');await expect(panel).not.toContainText(cards?'BR-CUSTOMER-001':'BR-CARD-001');await expect(panel).toContainText('yeni retrieval veya LLM işi başlatmaz');}
  await panel.locator('summary').click();await expect(panel.locator('.basics-how-body')).toHaveCount(0);
 }
 expect(calls).toEqual([]);
});

test('detailed explanation supports keyboard, per-step reset and safe Business/Technical snippets',async({page})=>{
 await open(page);const steps=page.locator('.basics-steps button'),panel=page.locator('.basics-how');
 await steps.nth(1).click();await panel.locator('summary').focus();await page.keyboard.press('Enter');
 await expect(panel.locator('code')).toHaveCount(1);await expect(panel.locator('code')).toContainText("owner = 'APP_SCHEMA'");
 await page.getByRole('button',{name:'Technical view',exact:true}).click();await expect(panel.locator('code')).toHaveCount(2);
 await expect(panel.locator('code').nth(1)).toContainText('table_name, column_name, data_type');
 await page.getByRole('button',{name:'Business view',exact:true}).click();await expect(panel.locator('code')).toHaveCount(1);
 await panel.locator('summary').focus();await page.keyboard.press('Space');await expect(panel.locator('.basics-how-body')).toHaveCount(0);
 await steps.nth(2).click();expect(await panel.evaluate(el=>el.open)).toBe(false);await panel.locator('summary').click();
 await page.getByRole('button',{name:'Technical view',exact:true}).click();await expect(panel.locator('code')).toHaveCount(4);await expect(panel.locator('code').nth(3)).toContainText('MAX(opened_at)');
 await page.getByRole('combobox',{name:'Banking workspace domain'}).selectOption('CARDS');await expect(page.getByTestId('basics-metrics')).toHaveText('164 metrik');expect(await panel.evaluate(el=>el.open)).toBe(false);
 await panel.locator('summary').click();await expect(panel.locator('code').nth(3)).toContainText('MAX(created_at)');
 await steps.nth(3).click();await panel.locator('summary').click();await expect(panel.locator('code')).toHaveCount(2);await expect(panel.locator('code').nth(1)).toContainText('CARDS');
 await page.getByRole('button',{name:'Play walkthrough',exact:true}).click();expect(await panel.evaluate(el=>el.open)).toBe(false);await page.getByRole('button',{name:'Stop walkthrough',exact:true}).click();
});

test('concept guide adds concise inline definitions alongside existing quick help',async({page})=>{
 await open(page);const guide=page.locator('.basics-glossary');expect(await guide.evaluate(el=>el.open)).toBe(false);await guide.locator('summary').first().click();
 for(const name of ['Oracle','PostgreSQL','Metadata','Aggregate SQL','Polars','DuckDB','Parquet','DataSketches','Sampling','Domain Config','Fingerprint','Coverage','Finding','RAG','LLM']){
  const item=guide.locator('.basics-reference>details').filter({has:page.getByText(name,{exact:true})});
  await item.locator('summary').click();await expect(item.locator('dt')).toHaveText(['WHAT IS IT?','WHERE DO WE USE IT?','WHY IS IT HERE?']);await expect(item.locator('dd')).toHaveCount(3);await item.locator('summary').click();
 }
 await guide.getByRole('button',{name:'Coverage hakkında',exact:true}).focus();await page.keyboard.press('Enter');await expect(guide.getByRole('tooltip')).toContainText('Underrepresented');await page.keyboard.press('Escape');
});

for(const domain of ['CUSTOMER_LENDING','CARDS'])test(`expanded ${domain} explanations fit mobile in both views`,async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});await open(page,domain);
 for(const view of ['Business view','Technical view']){
  await page.getByRole('button',{name:view,exact:true}).click();
  for(let i=0;i<8;i++){
   await page.locator('.basics-steps button').nth(i).click();await page.locator('.basics-how>summary').click();await expect(page.locator('.basics-how-body')).toBeVisible();
   expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  }
 }
 await page.reload();await expect(page.getByRole('combobox',{name:'Banking workspace domain'})).toHaveValue(domain);
});
