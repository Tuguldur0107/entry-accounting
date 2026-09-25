import {open,shot,flush,BASE} from '../common/harness.mjs';
const {browser,page}=await open({height:1400});
await page.goto(BASE+'/payroll',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
await page.getByRole('tab',{name:/Сүүл цалин/}).click().catch(()=>{}); await page.waitForTimeout(600);
const a=page.getByRole('link',{name:/GL журналын жагсаалтаас/}).first(); console.log('href',await a.getAttribute('href'));
await a.click(); await page.waitForTimeout(1500); console.log('url',page.url());
console.log((await page.locator('main').innerText()).replace(/\n+/g,' | ').slice(0,700));
await shot(page,'d-paylink'); flush(); await browser.close();
