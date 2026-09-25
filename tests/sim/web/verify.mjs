import {open,shot,flush,BASE} from '../common/harness.mjs';
const [,, token]=process.argv;
const {browser,page}=await open({height:900});
await page.goto(BASE+'/verify-email?token='+token,{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
console.log(page.url(), '|', (await page.locator('body').innerText()).replace(/\n+/g,' | ').slice(0,300));
await shot(page,'verify'); flush(); await browser.close();
