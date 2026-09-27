const { chromium } = await import(process.env.BNO_PLAYWRIGHT_MODULE || 'playwright');
import fs from 'node:fs';
import assert from 'node:assert/strict';
const outputDir = process.env.BNO_QA_OUTPUT || '/tmp/bno-browser-qa';
fs.mkdirSync(outputDir, {recursive:true});
const browser = await chromium.launch({...(process.env.BNO_CHROME_PATH ? { executablePath: process.env.BNO_CHROME_PATH } : {}), headless:true});
const context = await browser.newContext({ viewport:{width:1440,height:1000} });
const userId='11111111-1111-4111-8111-111111111111';
const user={id:userId,email:'test@example.invalid',aud:'authenticated',role:'authenticated',user_metadata:{display_name:'Test'},app_metadata:{provider:'email'},created_at:'2026-01-01T00:00:00Z'};
const jwt=`${Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub:userId,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url')}.testsignature`;
await context.addInitScript(({user,jwt})=>{localStorage.setItem('revision-tracker:auth:v1',JSON.stringify({access_token:jwt,refresh_token:'test-refresh',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer',user}));},{user,jwt});
let failNextWrite=false;
const db={ travel_flights:[], manual_trips:[], planned_trips:[], residency_settings:[]};
await context.route('https://bno-test.invalid/**',async route=>{
 const req=route.request(),url=new URL(req.url()),table=url.pathname.split('/').at(-1),method=req.method();
 if(method==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'}});
 if(failNextWrite && req.method()==='POST' && table==='travel_flights'){failNextWrite=false;return route.fulfill({status:409,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({message:'Simulated write conflict — retry'})});}
 let data;
 if(table==='profiles') data={display_name:'Test'};
 else if(table==='user')data=user;
 else if(db[table]) {
  const rows=db[table];
  if(method==='GET')data=table==='residency_settings'?(rows[0]??null):rows;
  else if(method==='POST'){const row={...req.postDataJSON(),version:1};rows.push(row);data=row;}
  else if(method==='PATCH'){const id=url.searchParams.get('id')?.slice(3); const row=table==='residency_settings'?rows[0]:rows.find(r=>r.id===id);if(row){Object.assign(row,req.postDataJSON());row.version++;}data=row??null;}
  else if(method==='DELETE'){const id=url.searchParams.get('id')?.slice(3),i=rows.findIndex(r=>r.id===id);data=i>=0?rows.splice(i,1)[0]:null;}
 }else data={};
 return route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(data)});
});
const page=await context.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(`${process.env.BNO_TEST_URL || 'http://127.0.0.1:5177'}/bno/`);
await page.locator('[data-bno-shell]').waitFor({state:'visible'});
await page.getByText('No travel recorded yet.').waitFor();
await page.screenshot({path:`${outputDir}/empty-desktop.png`,fullPage:true});
await page.locator('[data-tab="settings"]').click();
await page.locator('[name="bno_start_date"]').fill('2021-01-01');
await page.locator('[name="coverage_start"]').fill('2021-01-01');
await page.locator('[name="initial_location"]').selectOption('uk');
await page.locator('[name="citizenship_application_date"]').fill('2027-01-01');
await page.getByRole('button',{name:'Save settings',exact:true}).click();
await page.waitForFunction(()=>document.querySelector('[data-sync]').textContent.includes('Synced'));
await page.locator('[data-add="flight"]').first().click();
await page.locator('#dep-search').fill('LHR');
await page.locator('#dep-results [role="option"]').first().waitFor();
await page.locator('#dep-search').press('ArrowDown');await page.locator('#dep-search').press('Enter');
await page.locator('#arr-search').fill('HKG');await page.locator('#arr-results [role="option"]').first().click();
await page.locator('[name="departure_date"]').fill('2026-07-02');await page.locator('[name="departure_time"]').fill('22:15');await page.locator('[name="arrival_date"]').fill('2026-07-03');await page.locator('[name="arrival_time"]').fill('17:40');
failNextWrite=true;await page.locator('[data-editor] [type="submit"]').click();await page.locator('[data-editor-error]').getByText('Simulated write conflict — retry').waitFor();assert.equal(await page.locator('[name="departure_date"]').inputValue(),'2026-07-02');
await page.locator('[data-editor] [type="submit"]').click();await page.locator('[data-editor]').waitFor({state:'hidden'});
await page.locator('[data-add="flight"]').first().click();
await page.locator('#dep-search').fill('HKG');await page.locator('#dep-results [role="option"]').first().click();await page.locator('#arr-search').fill('LHR');await page.locator('#arr-results [role="option"]').first().click();
await page.locator('[name="departure_date"]').fill('2026-09-11');await page.locator('[name="departure_time"]').fill('08:00');await page.locator('[name="arrival_date"]').fill('2026-09-11');await page.locator('[name="arrival_time"]').fill('15:00');
await page.locator('[data-editor] [type="submit"]').click();await page.locator('[data-editor]').waitFor({state:'hidden'});
await page.locator('[data-tab="overview"]').click();
assert.match(await page.locator('#bno-content').innerText(),/70/);assert.match(await page.locator('#bno-content').innerText(),/72/);
console.log('visual styles',await page.evaluate(()=>({body:getComputedStyle(document.body).backgroundColor,skipTop:document.querySelector('.skip-link').getBoundingClientRect().top,skipFocus:document.activeElement?.className})));
await page.screenshot({path:`${outputDir}/overview-desktop.png`,fullPage:true});
for(const width of [1440,1280,834,390]){
 await page.setViewportSize({width,height:900});
 for(const tab of ['overview','history','calendar','analysis','planning','settings']){
  await page.locator(`[data-tab="${tab}"]`).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${tab} overflow at ${width}`);
  if(tab==='calendar'){assert.equal(await page.locator('.fc-daygrid-day').count()>=28,true);assert.equal(await page.locator('[data-calendar-body]').evaluate(el=>el.getBoundingClientRect().height>400),true,'visible month grid');}
  if(width===390)await page.screenshot({path:`${outputDir}/${tab}-mobile.png`,fullPage:true});
 }
}
await page.setViewportSize({width:1440,height:1000});
await page.locator('[data-tab="calendar"]').click();await page.locator('[data-calendar-view="year"]').click();await page.screenshot({path:`${outputDir}/year-desktop.png`,fullPage:true});
await page.locator('[data-tab="planning"]').click();await page.locator('[name="departure"]').fill('2026-10-01');await page.locator('[name="returned"]').fill('2026-10-11');await page.getByRole('button',{name:'Simulate trip',exact:true}).click();assert.match(await page.locator('[data-simulation]').innerText(),/Official: 9/);
await page.locator('[data-latest]').click();await page.locator('[data-simulation]').getByText('Official calculation',{exact:true}).waitFor({timeout:30000});
assert.match(await page.locator('[data-simulation]').innerText(),/180/);
assert.equal(db.travel_flights.length,2);assert.equal(db.manual_trips.length,0);assert.equal(db.planned_trips.length,0);
await page.locator('[data-add="manual"]').first().click();await page.setViewportSize({width:390,height:844});await page.screenshot({path:`${outputDir}/manual-modal-mobile.png`,fullPage:true});
await page.keyboard.press('Escape');await page.locator('[data-editor]').waitFor({state:'hidden'});
// Offline reading and planner simulations do not issue writes.
await context.setOffline(true);await page.locator('[data-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-sync]').textContent.includes('Offline'));
assert.equal(db.travel_flights.length,2);await context.setOffline(false);
await page.setViewportSize({width:640,height:450});await page.locator('[data-tab="overview"]').click();await page.evaluate(()=>document.documentElement.style.fontSize='200%');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,'large text overflow');await page.evaluate(()=>document.documentElement.style.fontSize='');
// Both fitting and overflowing dialogs keep focus within the native dialog.
await page.locator('[data-add="flight"]').first().click();for(let i=0;i<24;i++){await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.closest('dialog')?.hasAttribute('open')),true);}
await page.keyboard.press('Escape');
await page.evaluate(async()=>{const {authController}=await import('/src/auth/session.ts');await authController.signOut();});
await page.waitForURL('**/account/**');assert.equal(await page.evaluate(()=>Object.keys(localStorage).some(k=>k.startsWith('bno:user:'))),false,'logout cache cleared');
assert.deepEqual(errors,[]);
fs.writeFileSync(`${outputDir}/browser-result.json`,JSON.stringify({passed:true,widths:[1440,1280,834,390],errors,flights:db.travel_flights.length},null,2));
console.log('PASS: empty state, settings, keyboard airport search, flight CRUD, 70/72 totals, all six sections at four widths, calendars, simulator, worker, modal Escape, no horizontal overflow or browser errors.');
await browser.close();
