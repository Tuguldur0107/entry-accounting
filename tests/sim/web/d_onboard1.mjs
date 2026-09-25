// D · алхам 1-3: компанийн мэдээлэл, мөнгөн данс ×2, харилцагч ×8 (вэб-only)
import {open,shot,flush,BASE} from '../common/harness.mjs';
import {fill,clickBtn,toast,dlgText,pickSearchable} from './d_lib.mjs';
const {browser,page}=await open({height:1800,slow:true});
const log=(...a)=>console.log(...a);
// 1) компани
// 1) компани — хадгалагдсан (d1-company)
// 2) мөнгөн данс — үүссэн (d2-*)
// 3) харилцагч
const CPS=[['Номин Холдинг','Байгууллага','Авлага','2054567'],['Гоёо Дизайн ХХК','Байгууллага','Авлага','6011122'],['Сүхбаатар Түрээс ХХК','Байгууллага','Өглөг','5011166'],['УБЦТС ТӨХК','Байгууллага','Өглөг','2011001'],['Юнивишн ХХК','Байгууллага','Өглөг','5911036'],['Оюунаа (хувь хүн)','Хувь хүн','Авлага','УБ88020202'],['Мобиком Корпораци','Байгууллага','Авлага/Өглөг','2000601']];
for(const [nm,typ,side,reg] of CPS){
  await page.goto(BASE+'/receivables/counterparties',{waitUntil:'networkidle'}); await page.waitForTimeout(800);
  if(!(await clickBtn(page,'^Харилцагч$'))) await clickBtn(page,'нэмэх$'); await page.waitForTimeout(800);
  const d=page.locator('[role=dialog]').last();
  await fill(d,'Нэр',nm); await fill(d,'Төрөл',typ); await fill(d,'Тооцоо',side); await fill(d,'Регистр',reg); await fill(d,'Төлбөрийн нөхцөл',side==='Өглөг'?15:14);
  await d.getByRole('button',{name:/^Хадгалах$/}).click(); log('cp',nm,':',await toast(page));
}
await shot(page,'d3-counterparties'); flush(); await browser.close();
