// node web/form_peek.mjs <path> [buttonRegex] [shotname] — хуудас нээж (товч дарж) формын талбаруудыг жагсаана
import {open,shot,flush,BASE} from '../common/harness.mjs';
const [,, path, btn, name]=process.argv;
const {browser,page}=await open({height:1800});
await page.goto(BASE+path,{waitUntil:'networkidle'}); await page.waitForTimeout(1200);
if(btn){ const b=page.getByRole('button',{name:new RegExp(btn)}).first(); if(await b.count()){ await b.click(); await page.waitForTimeout(1200);} else console.log('no btn',btn); }
const fields=await page.evaluate(()=>{
  const out=[]; const seen=new Set();
  for(const el of document.querySelectorAll('input,select,textarea,[role=combobox],[role=switch],[role=checkbox],button[role=combobox]')){
    if(!(el.offsetParent||el.getClientRects().length)) continue;
    const id=el.id; let label='';
    if(id){ const l=document.querySelector(`label[for="${CSS.escape(id)}"]`); if(l) label=l.innerText.trim(); }
    if(!label){ const l=el.closest('label'); if(l) label=l.innerText.trim(); }
    if(!label){ const p=el.closest('div'); const l=p&&p.querySelector('label'); if(l) label=l.innerText.trim(); }
    const key=el.tagName+'|'+(el.name||id||label); if(seen.has(key)) continue; seen.add(key);
    out.push({tag:el.tagName.toLowerCase(),type:el.type||el.getAttribute('role'),name:el.name||'',id:id||'',label:label.slice(0,40),ph:el.placeholder||'',val:(el.value||el.innerText||'').slice(0,30)});
  }
  return out;
});
console.log(JSON.stringify(fields,null,0));
console.log('buttons',JSON.stringify((await page.getByRole('button').allInnerTexts()).filter(x=>x.trim()).slice(0,40)));
console.log('dialog',(await page.locator('[role=dialog]').last().innerText().catch(()=>'')).slice(0,600).replace(/\n+/g,' | '));
await shot(page,name||'form'); flush(); await browser.close();
