// D · вэб-only нэвтрүүлэлтийн туслах функцууд
export async function field(scope, label){
  // label текстээр input-ыг олно: label[for] → #id, эсвэл label-ын дараагийн input/select
  const lab=scope.locator('label').filter({hasText:label}).first();
  if(await lab.count()){
    const f=await lab.getAttribute('for');
    if(f){ const el=scope.locator(`#${CSS_escape(f)}`); if(await el.count()) return el.first(); }
    const nxt=lab.locator('xpath=following::*[self::input or self::select or self::textarea][1]');
    if(await nxt.count()) return nxt.first();
  }
  const byLabel=scope.getByLabel(label,{exact:false});
  if(await byLabel.count()) return byLabel.first();
  return null;
}
function CSS_escape(s){ return s.replace(/([^\w-])/g,'\\$1'); }
export async function fill(scope, label, value){
  const el=await field(scope,label);
  if(!el){ console.log('NOFIELD',label); return false; }
  const tag=await el.evaluate(e=>e.tagName.toLowerCase());
  if(tag==='select'){ try{ await el.selectOption({label:String(value)}); }catch{ await el.selectOption(String(value)); } return true; }
  await el.fill(String(value)); return true;
}
export async function pickSearchable(page, opener, text){
  // opener: товчны regex; portal дотор хайж сонгоно
  const b=page.getByRole('button',{name:opener}).first(); await b.click(); await page.waitForTimeout(500);
  const portal=page.locator('[data-searchable-portal]').last();
  const inp=portal.locator('input').first(); if(await inp.count()){ await inp.fill(text); await page.waitForTimeout(600); }
  const opt=portal.locator('button').filter({hasText:text}).first();
  if(await opt.count()){ await opt.click(); return true; }
  const any=page.getByRole('option').filter({hasText:text}).first(); if(await any.count()){ await any.click(); return true; }
  console.log('NOOPT',text,(await portal.innerText().catch(()=>'')).slice(0,200)); await page.keyboard.press('Escape'); return false;
}
export async function clickBtn(scope, name){
  const b=scope.getByRole('button',{name:new RegExp(name)}).first();
  if(!(await b.count())){ console.log('NOBTN',name); return false; }
  await b.click(); return true;
}
export async function toast(page, ms=12000){
  const t0=Date.now();
  while(Date.now()-t0<ms){ await page.waitForTimeout(600); const t=await page.locator('[data-sonner-toast]').allInnerTexts(); if(t.length) return t.join(' | '); }
  return '';
}
export async function dlgText(page){ return (await page.locator('[role=dialog]').last().innerText().catch(()=>'')).replace(/\n+/g,' | ').slice(0,500); }
