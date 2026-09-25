// python-friendly: node web/post_jv.mjs <YYYY-MM> <JV-NO> [tag]
import {open,shot,flush,BASE,setPeriod} from '../common/harness.mjs';
const [,, ym, no, tag]=process.argv;
const {browser,page}=await open();
await setPeriod(page,ym);
await page.goto(BASE+'/gl/journal',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
const nb=page.getByRole('button',{name:/^Ноорог\s*\d/}); if(await nb.count()) { await nb.first().click(); await page.waitForTimeout(700); }
const cell=page.locator('.ag-cell').filter({hasText:no}).first();
if(!(await cell.count())){ console.log('ROW NOT FOUND',no); await shot(page,`post-${no}-missing`); flush(); await browser.close(); process.exit(2); }
await cell.dblclick(); await page.waitForTimeout(1200);
const panel=page.locator('[role=dialog], [data-panel], .floating-panel').last();
const btns=await page.getByRole('button').allInnerTexts(); 
const post=page.getByRole('button',{name:/^Батлах$/}).last();
console.log('post btn',await post.count(), JSON.stringify(btns.filter(x=>/Батлах|Хадгалах|Ноорог|Болих/.test(x))));
if(await post.count()){ await post.click(); await page.waitForTimeout(800);
  const dlg=page.locator('[role=alertdialog], [role=dialog]').filter({hasText:/батлах уу|Батлах/}).last();
  if(await dlg.count()){ console.log('dlg',(await dlg.innerText()).slice(0,200).replace(/\n/g,' ')); const cb=dlg.getByRole('button',{name:/^Батлах/}).last(); if(await cb.count()) await cb.click(); }
  for(let i=0;i<20;i++){ await page.waitForTimeout(800); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length){console.log('toast',JSON.stringify(t));break;} }
}
await shot(page,`post-${tag||no}`);
flush(); await browser.close();
