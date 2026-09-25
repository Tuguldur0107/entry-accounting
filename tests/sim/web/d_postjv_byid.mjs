import {open,shot,flush,BASE} from '../common/harness.mjs';
import {toast,dlgText} from './d_lib.mjs';
const [,, id]=process.argv;
const {browser,page}=await open({height:1400});
for(const u of [`/gl/journal/${id}`, `/gl/journal?open=${id}`, `/gl/journal?id=${id}`]){
  await page.goto(BASE+u,{waitUntil:'networkidle'}).catch(()=>{}); await page.waitForTimeout(1500);
  const btns=(await page.getByRole('button').allInnerTexts()).filter(x=>x.trim());
  console.log(u,'→',page.url(),JSON.stringify(btns.slice(-8)));
  if(btns.some(x=>/^Батлах$/.test(x))){ await page.getByRole('button',{name:/^Батлах$/}).last().click(); await page.waitForTimeout(800); const d=page.locator('[role=dialog],[role=alertdialog]').last(); const names=await d.locator('button').allInnerTexts().catch(()=>[]); const bi=names.findIndex(x=>x.trim()==='Болих'); if(bi>=0 && /уу\?/.test(await d.innerText().catch(()=>''))) await d.locator('button').nth(bi+1).click(); console.log('toast',await toast(page)); break; }
}
await shot(page,'d-jv-byid'); flush(); await browser.close();
