// SearchableSelect-ийн гарын удирдлага: хайх → ↓ → Enter сонгоно; илэрцгүй Enter юу ч сонгохгүй.
// node web/searchable_select_kb.mjs [path] [tag]
import {open,shot,flush,BASE} from '../common/harness.mjs';
const [,, path='/procurement/orders', tag='ss-kb']=process.argv;
const {browser,page}=await open({});
await page.goto(BASE+path,{waitUntil:'networkidle'}); await page.waitForTimeout(1500);
const trigger=page.locator('button.ea-form-select').first();
const before=(await trigger.innerText()).trim();
await trigger.click(); await page.waitForTimeout(300);
const input=page.locator('[data-searchable-portal] input');
const opts=await page.locator('[data-searchable-portal] [role=option]').allInnerTexts();
console.log('before', JSON.stringify(before), 'options', opts.length, JSON.stringify(opts.slice(0,4)));
await input.press('ArrowDown'); await input.press('Enter'); await page.waitForTimeout(500);
const afterArrow=(await trigger.innerText()).trim();
console.log('after ↓+Enter', JSON.stringify(afterArrow), 'expected', JSON.stringify(opts[1]??opts[0]));
await trigger.click(); await page.waitForTimeout(300);
await input.fill('zzzz-илэрцгүй'); await input.press('Enter'); await page.waitForTimeout(300);
const portalOpen=await page.locator('[data-searchable-portal]').count();
const afterNoMatch=(await trigger.innerText()).trim();
console.log('no-match Enter → value', JSON.stringify(afterNoMatch), 'portal open', portalOpen);
await input.press('Escape'); await page.waitForTimeout(200);
await shot(page, tag);
flush(); await browser.close();
