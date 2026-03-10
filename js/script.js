/* ====== Эндпоинты ====== */
const EP_BASE   = '/api/kprint-prices.php';          // квадратное <10k (base)
const EP_SQ10K  = '/api/kprint-square-10kplus.php';  // квадратное ≥10k (формулы)
const EP_VB     = '/api/kprint-vbottom.php';         // V-дно

const tg = n => new Intl.NumberFormat('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number.isFinite(n)?n:0)+' ₸';
const $ = id => document.getElementById(id);
const norm = s => String(s||'').trim().replace(/[×хx]/gi,'x');
const show = (id,on)=>{ const el=$(id); if(el) el.classList.toggle('hide',!on); };
const showEl = (el,on)=>{ if(el) el.classList.toggle('hide',!on); };

/* ===== режимы ===== */
function kind(){ return (document.querySelector('input[name="kind"]:checked')?.value || 'square'); }
function isSquare(){ return kind()==='square'; }
function isV(){ return kind()==='vbottom'; }

/* ===== глобальные данные ===== */
let BASEBOOK=null, BASEMAP=null; // /kprint-prices
let SQ10K=null;                  // /kprint-square-10kplus
let VB=null;                     // /kprint-vbottom

/* ===== загрузка данных ===== */
async function loadBase(){
    const r=await fetch(EP_BASE,{cache:'no-store'}); if(!r.ok) throw new Error('base HTTP '+r.status);
    BASEBOOK=await r.json();
    BASEMAP = { with:{white:{},brown:{}}, without:{white:{},brown:{}} };
    for(const handles of ['with','without']){
        for(const color of ['white','brown']){
            const map = BASEBOOK.base?.[handles]?.[color] || {};
            for(const k in map) BASEMAP[handles][color][ norm(k) ] = Number(map[k]);
        }
    }
}
async function loadSq10k(){
    const r=await fetch(EP_SQ10K,{cache:'no-store'}); if(!r.ok) throw new Error('sq10k HTTP '+r.status);
    SQ10K=await r.json();
    ['roll_widths','rapports','width_options'].forEach(key=>{
        if(Array.isArray(SQ10K[key])) SQ10K[key].sort((a,b)=>a-b);
    });
}
async function loadVb(){
    const r=await fetch(EP_VB,{cache:'no-store'}); if(!r.ok) throw new Error('vb HTTP '+r.status);
    VB=await r.json();
    if (Array.isArray(VB.RAPPORTS)) VB.RAPPORTS.sort((a,b)=>a.rapport_mm-b.rapport_mm);
    if (Array.isArray(VB.WIDTH_OPTIONS_VB)) VB.WIDTH_OPTIONS_VB.sort((a,b)=>a.width_mm-b.width_mm);
}

/* ===== селекты ===== */
function fillColorCount(){ const sel=$('colors'); sel.innerHTML=''; [1,2,3,4].forEach(v=>{const o=document.createElement('option');o.value=v;o.text=v;sel.add(o);}); }
function fillReadySizes(){
    const sel=$('readyPack'); sel.innerHTML='';
    const handles=($('handles').value==='Да')?'with':'without';
    const color=$('baseColor').value; // white|brown (важно!)
    const map = BASEMAP?.[handles]?.[color] || {};
    Object.keys(map).map(k=>k.replace(/x/g,'×')).sort((a,b)=>+a.split('×')[0]-+b.split('×')[0])
        .forEach(sz=>{ const o=document.createElement('option'); o.value=sz; o.text=sz; sel.add(o); });
}
function fillMaterial(){
    const sel=$('material'); sel.innerHTML='';
    if(isSquare()){
        // квадратное ≥10k использует материалы из SQ10K
        (SQ10K?.materials||[]).forEach(m=>{ const o=document.createElement('option'); o.value=m.material_id; o.text=m.name_ru; sel.add(o); });
    }else{
        // V-дно — свои материалы
        (VB?.MATERIALS||[]).forEach(m=>{ const o=document.createElement('option'); o.value=m.material_id; o.text=m.name_ru; sel.add(o); });
    }
}
function fillWidthOptions(){
    const sel=$('width'); sel.innerHTML='';
    if(isSquare()){
        (SQ10K?.width_options||[]).forEach(v=>{ const o=document.createElement('option'); o.value=v; o.text=v; sel.add(o); });
    }else{
        (VB?.WIDTH_OPTIONS_VB||[]).forEach(r=>{ const o=document.createElement('option'); o.value=r.width_mm; o.text=r.width_mm; sel.add(o); });
    }
}

/* ===== видимость блоков ===== */
function toggleBlocks(){
    const qty=+$('qty').value||0;

    // Для квадратного дна переключаемся между <10k и ≥10k автоматически по тиражу
    const isLt10k = isSquare() && qty < 10000;

    // цвет только для <10k; материалы — для ≥10k и V-дно
    show('colorBlock', isLt10k);
    show('materialBlock', !isLt10k);

    show('readyPackBlock', isLt10k);
    show('printTypeBlock', isLt10k);
    show('chromacityBlock', isLt10k);

    show('f-width',  !isLt10k);
    show('f-depth',  !isLt10k);
    show('f-height', !isLt10k);
    show('f-colors', !isLt10k);

    show('windowBlock', isV());

    // ручки — только квадратное
    show('handlesBlock', isSquare());

    // подсказки рекомендуемых — только квадратное по формулам (≥10k)
    showEl($('hintWidth'),  isSquare() && !isLt10k);
    showEl($('hintDepth'),  isSquare() && !isLt10k);

    const winChecked = $('hasWindow')?.checked;
    show('windowWidthBlock', isV() && winChecked);

    if (isLt10k) {
        fillReadySizes();
    } else {
        fillMaterial();
        fillWidthOptions();
    }

    updateQtyWarning();
    updateRollWarning();
    updateRapportWarning();
    checkWindowWidth();
}

/* ===== предупреждения и блокировка кнопки ===== */
function hasBasePrices(){
    if(!BASEMAP) return false;
    const n = ['with','without'].flatMap(h=>['white','brown'].map(c=>Object.keys(BASEMAP[h]?.[c]||{}).length)).reduce((a,b)=>a+b,0);
    return n>0;
}
function updateQtyWarning(){
    const qty=+$('qty').value||0;
    const isLt10k = isSquare() && qty < 10000;
    const w=$('qtyWarning'), btn=$('calcBtn');

    if (isV()){
        if(qty<10000){ w.textContent='⚠️ Минимальный тираж: 10 000 шт'; w.classList.remove('hide'); btn.disabled=true; return; }
        w.classList.add('hide'); btn.disabled=false; return;
    }

    // квадратное
    if (isLt10k){
        if(qty<500){ w.textContent='⚠️ Минимальный тираж: 500 шт'; w.classList.remove('hide'); btn.disabled=true; return; }
        if(!hasBasePrices()){ w.textContent='⚠️ Онлайн-прайс недоступен — расчёт 500–9 999 недоступен.'; w.classList.remove('hide'); btn.disabled=true; return; }
        w.classList.add('hide'); btn.disabled=false; return;
    }
    // ≥10k
    if(qty<10000){ w.textContent='⚠️ Минимальный тираж: 10 000 шт'; w.classList.remove('hide'); btn.disabled=true; return; }
    w.classList.add('hide'); btn.disabled=false;
}
function getMaxRollAndAllowance(){
    if(isV()){
        const maxRoll = Number(VB?.CONFIG_VB?.find(k=>k.key==='max_roll_width_mm')?.value||780);
        const allowance = Number(VB?.CONFIG_VB?.find(k=>k.key==='roll_allowance_mm')?.value||20);
        return {maxRoll, allowance};
    }else{
        const allowance = Number(SQ10K?.config?.find(k=>k.key==='roll_allowance_mm')?.value||30);
        const rolls = (SQ10K?.roll_widths||[]).slice().sort((a,b)=>a-b);
        const maxRoll = rolls.length? rolls[rolls.length-1] : 1200;
        return {maxRoll, allowance};
    }
}
function updateRollWarning(){
    const qty=+$('qty').value||0;
    const isLt10k = isSquare() && qty < 10000;
    const warn=$('rollWarning'), btn=$('calcBtn');

    if (isLt10k){ warn.classList.add('hide'); warn.innerHTML=''; maybeToggleCalc(); return; }

    const w=+$('width').value||0, d=+$('depth').value||0;
    const {maxRoll, allowance}=getMaxRollAndAllowance();
    const need=(w+d)*2+allowance;

    if(need<=maxRoll){ warn.classList.add('hide'); warn.innerHTML=''; maybeToggleCalc(); }
    else{
        const maxD=Math.max(0,Math.floor(((maxRoll-allowance)/2)-w));
        const maxW=Math.max(0,Math.floor(((maxRoll-allowance)/2)-d));
        warn.innerHTML=`При ширине ${w} → глубина до <b>${maxD}</b> мм. При глубине ${d} → ширина до <b>${maxW}</b> мм.`;
        warn.classList.remove('hide');
        $('calcBtn').disabled=true;
    }
}
function checkWindowWidth() {
    const warn = $('windowWarning');
    if (!warn) return;

    if (isV() && $('hasWindow')?.checked) {
        const w = +$('width').value || 0;
        const ww = +$('windowWidth').value || 0;
        const maxW = w - 80; // Ширина окна не может превышать ширина_пакета - 80мм

        if (maxW <= 0) {
            warn.innerHTML = `Ширина пакета должна быть больше 80 мм для добавления окна.`;
            warn.classList.remove('hide');
        } else if (ww > maxW) {
            warn.innerHTML = `Ширина окна не может превышать <b>${maxW}</b> мм.`;
            warn.classList.remove('hide');
        } else {
            warn.classList.add('hide');
            warn.innerHTML = '';
        }
    } else {
        warn.classList.add('hide');
        warn.innerHTML = '';
    }
}
function getRapportMax(){
    if(isV()){
        const arr=(VB?.RAPPORTS||[]).map(r=>r.rapport_mm).sort((a,b)=>a-b);
        return arr.length?arr[arr.length-1]:Infinity;
    }else{
        const arr=(SQ10K?.rapports||[]).slice().sort((a,b)=>a-b);
        return arr.length?arr[arr.length-1]:Infinity;
    }
}
function updateRapportWarning(){
    const qty=+$('qty').value||0;
    const isLt10k = isSquare() && qty < 10000;
    const warn=$('rapportWarning');

    if (isLt10k){ warn.classList.add('hide'); warn.innerHTML=''; maybeToggleCalc(); return; }

    const d=+$('depth').value||0, h=+$('height').value||0;
    const k = isV() ? 0.67 : Number(SQ10K?.config?.find(k=>k.key==='depth_coeff')?.value||0.67);
    const need = d*k + h;
    const maxR = getRapportMax();

    if(need<=maxR){ warn.classList.add('hide'); warn.innerHTML=''; maybeToggleCalc(); }
    else{
        const maxH=Math.max(0,Math.floor(maxR - d*k));
        const maxD=Math.max(0,Math.floor((maxR - h)/k));
        warn.innerHTML=`При глубине ${d} → высота до <b>${maxH}</b> мм. При высоте ${h} → глубина до <b>${maxD}</b> мм.`;
        warn.classList.remove('hide');
        $('calcBtn').disabled=true;
    }
}
function maybeToggleCalc(){
    const btn=$('calcBtn');
    const hasWarn = !$('qtyWarning').classList.contains('hide')
        || !$('rollWarning').classList.contains('hide')
        || !$('rapportWarning').classList.contains('hide')
        || ($('windowWarning') && !$('windowWarning').classList.contains('hide')); // <-- Добавлено
    btn.disabled = hasWarn;
}

/* ===== утилиты ===== */
function minAtLeast(sorted, t){ for(const v of sorted){ if(v>=t) return v; } return sorted[sorted.length-1]; }
function pickPercent(rows, qty, from='from_qty', to='to_qty', val='percent'){
    if(!rows) return 0;
    // Функция для очистки строки от запятых и пробелов перед парсингом
    const parseNum = v => Number(String(v||'').replace(/[,\s]/g, ''));

    for(const r of rows){
        const f = parseNum(r[from]) || 1;
        const tt = parseNum(r[to]) || 999999999;
        if(qty >= f && qty <= tt) return parseNum(r[val]) || 0;
    }
    return parseNum(rows.at(-1)?.[val]) || 0;
}
function colorMakeready(colors){
    const rows = SQ10K?.color_make_ready || VB?.COLOR_MAKE_READY || [];
    const row = rows.find(r=>+r.colors===+colors);
    return +row?.makeready_tg||0;
}

/* ===== расчёты ===== */
// <10k по прайсу
function calcSquareLt10k(){
    const qty=+$('qty').value;
    const handles=($('handles').value==='Да')?'with':'without';
    const color=$('baseColor').value; // ВАЖНО: используем цвет, а не материал
    const sizeKey=norm($('readyPack').value);
    const base=Number(BASEMAP?.[handles]?.[color]?.[sizeKey]||0);
    if(!base){ alert('Для выбранного размера нет цены.'); return; }

    const sides=(document.querySelector('input[name="printType"]:checked')?.value==='two')?2:1;
    const chroma=$('chromacity').value;
    const setup=Number(BASEBOOK.print?.makeready_per_side_tg||0);
    const rate=Number(BASEBOOK.print?.rates?.[chroma]?.[String(sides)]||0);
    const techP=pickPercent(BASEBOOK.tech_reserve,qty,'from','to','value');

    const baseSum=qty*base, make=setup*sides, print=rate*qty, tech=(qty*(techP/100))*base;
    const total = baseSum + make + print + tech;
    const unit  = total/qty;

    $('ppu').textContent=tg(unit);
    $('cliche').textContent=tg(0);
    $('sum').textContent=tg(total);
}
// ≥10k квадратное — как в предыдущей версии (с материалом из SQ10K)
function calcSquareGte10k(){
    const qty=+$('qty').value;
    const w=+$('width').value, d=+$('depth').value, h=+$('height').value;
    const mat=(SQ10K?.materials||[]).find(m=>m.material_id===$('material').value);
    if(!mat){ alert('Выберите материал'); return; }
    const gsm=+mat.gsm||0, priceKg=+mat.price_per_kg_tg||0;

    const meterDiv=+(SQ10K?.config?.find(i=>i.key==='meter_divider')?.value||1000);
    const areaDiv =+(SQ10K?.config?.find(i=>i.key==='area_divider')?.value||10000);
    const gsmDiv  =+(SQ10K?.config?.find(i=>i.key==='gsm_divider')?.value||100000);
    const rowsPerRoll=+(SQ10K?.config?.find(i=>i.key==='default_rows_per_roll')?.value||1);
    const rowsPerRap =+(SQ10K?.config?.find(i=>i.key==='default_rows_per_rapport')?.value||1);
    const rollAllow  =+(SQ10K?.config?.find(i=>i.key==='roll_allowance_mm')?.value||30);
    const depthK     =+(SQ10K?.config?.find(i=>i.key==='depth_coeff')?.value||0.67);
    const ratePerMeter=+(SQ10K?.config?.find(i=>i.key==='print_rate_per_meter')?.value||7);
    const cmDiv      =+(SQ10K?.config?.find(i=>i.key==='cm_divider')?.value||10);
    const clichePerCm2=+(SQ10K?.config?.find(i=>i.key==='cliche_price_per_cm2')?.value||15);
    const clicheReserve=+(SQ10K?.config?.find(i=>i.key==='cliche_min_reserve_tg')?.value||10000);
    const roundStep  =+(SQ10K?.config?.find(i=>i.key==='round_step_tg')?.value||0.5);

    const rapArr=(SQ10K?.rapports||[]).slice().sort((a,b)=>a-b);
    const C16=minAtLeast(rapArr, d*depthK + h);

    const B11=(C16/meterDiv)*qty;
    const B12=(B11/rowsPerRoll)/rowsPerRap;

    const colors=+$('colors').value;
    const B13=colorMakeready(colors);

    const rollArr=(SQ10K?.roll_widths||[]).slice().sort((a,b)=>a-b);
    const B16=minAtLeast(rollArr, (w+d)*2 + rollAllow);

    const C18=(B16*C16)/areaDiv * (gsm/gsmDiv) / rowsPerRoll / rowsPerRap;
    const B18=qty*C18;

    const techP=pickPercent(SQ10K?.tech_reserve,qty,'from_qty','to_qty','percent');
    const B19=B18*(1 + techP/100);

    const B20=B19*priceKg;
    const B21=B12*ratePerMeter;

    const rec=SQ10K?.recommended||[];
    const wOk=rec.some(x=>x.type==='width' && +x.value===w);
    const dOk=rec.some(x=>x.type==='depth' && +x.value===d);
    const fs=(SQ10K?.forming_setup_rules||{});
    const B22 = (wOk && dOk) ? +fs.both_recommended||30000
        : dOk ? +fs.only_depth_recommended||40000
            : wOk ? +fs.only_width_recommended||70000
                : +fs.none_recommended||80000;

    const rateW=(SQ10K?.forming_rate_by_width||[]).find(r=>w>=+r.width_min && w<=+r.width_max)?.rate_per_meter_tg||0;
    const B23=B12* +rateW;

    const C24=($('handles').value==='Да')?20:0;
    const B24=C24*qty;

    const B25=(B20 + B21 + B22 + B23 + B24) + B13;
    const marginP=pickPercent(SQ10K?.margin,qty,'from_qty','to_qty','percent');
    const B26=B25*(1 + marginP/100);
    const B27=B26/qty;

    const B32=((w+d)*2 + rollAllow)/cmDiv;
    const C32=C16/cmDiv;
    const C34=(B32*C32)*clichePerCm2*colors + clicheReserve;

    const unit=Math.ceil(B27/roundStep)*roundStep;
    $('ppu').textContent=tg(unit);
    $('cliche').textContent=tg(C34);
    $('sum').textContent=tg(unit*qty + C34);
}
// V-дно (без изменений)
function pickRapportV(height){
    const th=+(VB?.CONFIG_VB?.find(k=>k.key==='split_height_threshold_mm')?.value||160);
    const add=+(VB?.CONFIG_VB?.find(k=>k.key==='height_allowance_mm')?.value||20);
    const mult=+(VB?.CONFIG_VB?.find(k=>k.key==='small_height_multiplier')?.value||2);
    const rap=(VB?.RAPPORTS||[]).map(r=>r.rapport_mm).sort((a,b)=>a-b);
    if(height>th){ return minAtLeast(rap, height+add); }
    const base=minAtLeast(rap,(height+add)*mult); return base/2;
}
function calcVbottom(){
    const qty=+$('qty').value;
    const w=+$('width').value, d=+$('depth').value, h=+$('height').value;
    const mat=(VB?.MATERIALS||[]).find(m=>m.material_id===$('material').value);
    if(!mat){ alert('Выберите материал'); return; }
    const gsm=+mat.gsm||0, priceKg=+mat.price_per_kg_tg||0;

    const meterDiv=+(VB?.CONFIG_VB?.find(i=>i.key==='meter_divider')?.value||1000);
    const areaDiv =+(VB?.CONFIG_VB?.find(i=>i.key==='area_divider')?.value||10000);
    const gsmDiv  =+(VB?.CONFIG_VB?.find(i=>i.key==='gsm_divider')?.value||100000);
    const rollAllow=+(VB?.CONFIG_VB?.find(i=>i.key==='roll_allowance_mm')?.value||20);
    const cmDiv    =+(VB?.CONFIG_VB?.find(i=>i.key==='cm_divider')?.value||10);
    const ratePrint=+(VB?.CONFIG_VB?.find(i=>i.key==='print_rate_per_meter')?.value||3);
    const formSetup=+(VB?.FORMING_VB||[]).find(i=>i.key==='forming_setup_tg')?.value_tg || 12000;
    const formRate =+(VB?.FORMING_VB||[]).find(i=>i.key==='forming_rate_per_unit_tg')?.value_tg || 3;

    //const B12=(w+d)*2 + rollAllow;
    //const C12=pickRapportV(h);
//
    //const rowsRoll=+(VB?.CONFIG_VB?.find(i=>i.key==='default_rows_per_roll')?.value||1);
    //const rowsRap =+(VB?.CONFIG_VB?.find(i=>i.key==='default_rows_per_rapport')?.value||1);
    //const B13=(C12/meterDiv)*qty;
    //const B14=(B13/rowsRoll)/rowsRap;
//
    //const C16=(B12*C12)/areaDiv * (gsm/gsmDiv);
    //const B16=qty*C16;

    const techP=pickPercent(VB?.TECH_RESERVE_VB,qty,'from_qty','to_qty','percent');

    const B12=(w+d)*2 + rollAllow; // Общая ширина развертки
    const C12=pickRapportV(h);     // Раппорт

    const rowsRoll=+(VB?.CONFIG_VB?.find(i=>i.key==='default_rows_per_roll')?.value||1);
    const rowsRap =+(VB?.CONFIG_VB?.find(i=>i.key==='default_rows_per_rapport')?.value||1);
    const B13=(C12/meterDiv)*qty;
    const B14=(B13/rowsRoll)/rowsRap;

    // --- ЛОГИКА ОКОШКА ---
    const hasWindow = $('hasWindow')?.checked;
    const ww = +$('windowWidth').value || 0;

    let paperWidthForArea = B12;
    let filmCostTotal = 0;

    let B20 = formSetup;      // Приладка
    let B21 = qty * formRate; // Формовка тиража

    if (hasWindow) {
        // 1. Увеличиваем приладку и формовку в 2 раза
        B20 *= 2;
        B21 *= 3;

        // 2. Вычитаем бумагу и добавляем пленку
        paperWidthForArea = B12 - ww;
        const filmWidth = ww + 30; // +30мм (по 15мм с каждой стороны) на склейку пленки с бумагой

        // Достаем данные из API (таблица TFW)
        const filmData = (VB?.TFW||[]).find(m => m.material_id === 'transparent_film') || {};

        const filmGsm = +(filmData.gsm || 40); // вес пленки (допустим 40г/м2)
        const filmPriceKg = +(filmData.price_per_kg_tg || 0);

        // Считаем вес пленки аналогично бумаге
        const filmC16 = (filmWidth * C12)/areaDiv * (filmGsm/gsmDiv);
        const filmB16 = qty * filmC16;
        const filmB17 = filmB16 * (1 + techP/100);
        filmCostTotal = filmB17 * filmPriceKg;
    }
    // ----------------------

    // Площадь и стоимость БУМАГИ (используем paperWidthForArea вместо B12)
    const C16=(paperWidthForArea*C12)/areaDiv * (gsm/gsmDiv);
    const B16=qty*C16;
    const B17=B16*(1 + techP/100);
    const B18=B17*priceKg; // Стоимость бумаги

    const B19=B14*ratePrint;

    const colors=+$('colors').value;
    const B11=colorMakeready(colors);

    // Добавляем стоимость пленки и клея к общей себестоимости пакета
    const B22=(B18 + filmCostTotal + B19 + B20 + B21) + B11;

    const marginP=pickPercent(VB?.MARGIN_VB,qty,'from_qty','to_qty','percent');
    const B23=B22*(1 + marginP/100);
    const unit=B23/qty;

    const B28=B12/cmDiv;
    let C28;
    const th=+(VB?.CONFIG_VB?.find(k=>k.key==='split_height_threshold_mm')?.value||160);
    if(h>th){ C28=Math.ceil(C12/cmDiv); }
    else{
        const mult=+(VB?.CONFIG_VB?.find(k=>k.key==='small_height_multiplier')?.value||2);
        const add =+(VB?.CONFIG_VB?.find(k=>k.key==='height_allowance_mm')?.value||20);
        const rap=(VB?.RAPPORTS||[]).map(r=>r.rapport_mm).sort((a,b)=>a-b);
        const base=minAtLeast(rap,(h+add)*mult); C28=Math.ceil(base/cmDiv);
    }
    const clichePerCm2=+(VB?.CONFIG_VB?.find(k=>k.key==='cliche_price_per_cm2')?.value||15);
    const C30=(B28*C28)*clichePerCm2*colors;

    $('ppu').textContent=tg(unit);
    $('cliche').textContent=tg(C30);
    $('sum').textContent=tg(unit*qty + C30);
}

/* ===== биндинги ===== */
function bind(){
    $('qty').addEventListener('input', ()=>{ toggleBlocks(); maybeToggleCalc(); });
    $('hasWindow')?.addEventListener('change', ()=>{ toggleBlocks(); maybeToggleCalc(); });
    $('windowWidth')?.addEventListener('input', ()=>{ checkWindowWidth(); maybeToggleCalc(); });
    document.querySelectorAll('input[name="kind"]').forEach(el=>{
        el.addEventListener('change', ()=>{ toggleBlocks(); maybeToggleCalc(); });
    });

    // <10k: изменения цвета/ручек влияют на список размеров
    ['baseColor','handles'].forEach(id=>{
        $(id).addEventListener('change', ()=>{ if(isSquare() && +$('qty').value<10000) fillReadySizes(); });
    });

    // проверки рулон/раппорт
    ['input','change','blur'].forEach(ev=>{
        $('width') ?.addEventListener(ev, ()=>{ updateRollWarning(); updateRapportWarning(); checkWindowWidth(); });
        $('depth') ?.addEventListener(ev, ()=>{ updateRollWarning(); updateRapportWarning(); });
        $('height')?.addEventListener(ev, ()=>{                      updateRapportWarning(); });
    });

    $('calcBtn').addEventListener('click', ()=>{
        const qty=+$('qty').value||0;
        if(isV()) { if(qty<10000) return; calcVbottom(); return; }
        if(qty<10000) calcSquareLt10k(); else calcSquareGte10k();
    });
}

/* ===== init ===== */
(async function init(){
    try{ await Promise.allSettled([loadBase(), loadSq10k(), loadVb()]); }catch(e){ console.warn(e); }
    fillColorCount();
    toggleBlocks();
    bind();
})();