// ===== ヘッダー高さに応じて --header-offset を更新 =====
function adjustHeaderOffset(){
  var header = document.querySelector('header');
  if (!header) return;
  var h = header.getBoundingClientRect().height;
  document.documentElement.style.setProperty('--header-offset', h + 'px');
}
window.addEventListener('load', adjustHeaderOffset);
window.addEventListener('resize', adjustHeaderOffset);

// ===== Helpers =====
const $  = (s)=>document.querySelector(s);
const $$ = (s)=>Array.from(document.querySelectorAll(s));
const pad=(n)=>String(n).padStart(2,'0');
const toISO=(local)=>{
  const d=new Date(local);
  if(isNaN(d)) return '';
  return d.toISOString();
};
function uuid(){
  const a=crypto.getRandomValues(new Uint8Array(16));
  a[6]=(a[6]&0x0f)|0x40;
  a[8]=(a[8]&0x3f)|0x80;
  return [...a].map(x=>x.toString(16).padStart(2,'0')).join('');
};

// ===== Storage =====
const S='meetups-store', O='meetups-owners';
const readStore =()=>JSON.parse(localStorage.getItem(S)||'[]');
const writeStore=(arr)=>localStorage.setItem(S,JSON.stringify(arr));
const readOwners=()=>JSON.parse(localStorage.getItem(O)||'{}');
const writeOwners=(map)=>localStorage.setItem(O,JSON.stringify(map));
const isOwner   =(roomId)=>Boolean(readOwners()[roomId]);

const REGISTRY_API = 'https://do-chat.awachima7.workers.dev/api/rooms';
const NEGATIVE_LIMIT_MS = 20*60*1000;

// ===== タイマー & 自動削除 =====
function autoDeleteRoom(roomId){
  if (!roomId) return;
  const remain = readStore().filter(x => x.roomId !== roomId);
  writeStore(remain);
  const owners = readOwners();
  if (owners[roomId]){
    delete owners[roomId];
    writeOwners(owners);
  }
}

// ===== カウントダウン =====
function initCountdown(card){
  const start = new Date(card.dataset.start);
  const el    = card.querySelector('[data-countdown]');
  const label = (window.i18n && window.i18n.meetups && window.i18n.meetups.cardStartsLabel) || 'Starts in';
  const roomId = card.dataset.roomId || '';
  const expireAt = new Date(start.getTime() + NEGATIVE_LIMIT_MS);

  const tick = ()=>{
    const now  = new Date();

    const diff = start - now;
    if (diff > 0){
      const h=Math.floor(diff/3600000),
            m=Math.floor(diff/60000)%60,
            s=Math.floor(diff/1000)%60;
      if (el) el.textContent = `${label}: ${pad(h)}:${pad(m)}:${pad(s)}`;
      requestAnimationFrame(tick);
      return;
    }
    const remainMs = expireAt - now;
    if (remainMs > 0){
      const expLabel = (window.i18n && window.i18n.meetups && window.i18n.meetups.cardExpiresIn) || 'Expires in';
      const remainMin = Math.ceil(remainMs/60000);
      if (el) el.textContent = `${expLabel} ${pad(remainMin)} min`;
      requestAnimationFrame(tick);
    } else {
      const expiredLabel = (window.i18n && window.i18n.meetups && window.i18n.meetups.cardExpired) || 'Expired';
      if (el) el.textContent = expiredLabel;
      autoDeleteRoom(roomId);
    }
  };
  requestAnimationFrame(tick);
}

function formatFeeLabel(item){
  const feeType = item.feeType || 'free';
  const feeAmount = (item.feeAmount || '').trim();
  const lang = (window.currentLang || document.documentElement.lang || 'en').toLowerCase();
  const isJa = lang.startsWith('ja');
  if (feeType === 'paid'){
    if (isJa){
      return feeAmount ? `有料イベント（${feeAmount}円）` : '有料イベント';
    } else {
      return feeAmount ? `Paid event (${feeAmount})` : 'Paid event';
    }
  } else {
    return isJa ? '無料イベント' : 'Free event';
  }
}

// ===== カード操作 =====
function attachEnter(card){
  const btn=card.querySelector('[data-enter]');
  btn.onclick=()=>{
    // ▼ ここで現在の言語を取得して lobby.html に渡す
    let currentLang = 'en';
    if (window.currentLang){
      currentLang = window.currentLang;
    } else {
      try{
        const stored = localStorage.getItem('lang');
        if (stored) currentLang = stored;
      }catch(e){}
    }

    const p=new URLSearchParams({
      roomId: card.dataset.roomId || '',
      title : card.dataset.title,
      start : card.dataset.start,
      limit : card.dataset.limit,
      target: card.dataset.url,
      feeType: card.dataset.feeType || 'free',
      feeAmount: card.dataset.feeAmount || '',
      lang  : currentLang
    });
    location.href = `./lobby.html?${p.toString()}`;
  };
}

function renderTools(card){
  const roomId=card.dataset.roomId;
  let tools=card.querySelector('.tools');
  if(!tools){
    tools=document.createElement('div');
    tools.className='tools';
    card.appendChild(tools);
  }
  tools.innerHTML='';
  if(roomId && isOwner(roomId)){
    const b=document.createElement('button');
    b.className='btn icon';
    b.title='Edit';
    b.textContent='✎';
    b.onclick=()=>openModal('edit', {
      roomId,
      title: card.dataset.title,
      start: card.dataset.start,
      limit: card.dataset.limit,
      target: card.dataset.url,
      feeType: card.dataset.feeType || 'free',
      feeAmount: card.dataset.feeAmount || ''
    });
    tools.appendChild(b);
  }
}

function upsertCard(item){
  const grid=$('#grid');
  let card=grid.querySelector(`.card[data-room-id="${item.roomId}"]`);
  if(!card){
    card=document.createElement('article');
    card.className='card';
    const t = (window.i18n && window.i18n.meetups) || {};
    const startLabel = t.cardStartsLabel || 'Starts in';
    const enterLabel = t.enterLobby || 'Enter Lobby';
    card.innerHTML=`
      <div class="title"></div>
      <div class="meta" data-fee></div>
      <div class="meta"><span data-countdown>${startLabel}: --:--:--</span></div>
      <div><a class="btn" data-enter>${enterLabel}</a></div>`;
  }
  card.dataset.roomId=item.roomId;
  card.dataset.title=item.title;
  card.querySelector('.title').textContent=item.title;
  card.dataset.start=item.start;
  card.dataset.url=item.target;
  card.dataset.limit=item.limit;
  card.dataset.feeType = item.feeType || 'free';
  card.dataset.feeAmount = item.feeAmount || '';

  const feeEl = card.querySelector('[data-fee]');
  if (feeEl){
    feeEl.textContent = formatFeeLabel(item);
    feeEl.style.display = feeEl.textContent ? '' : 'none';
  }

  if (card.parentElement !== grid) grid.prepend(card);
  initCountdown(card);
  attachEnter(card);
  renderTools(card);
}

function persist(item){
  const arr=readStore().filter(x=>x.roomId!==item.roomId);
  arr.unshift(item);
  writeStore(arr.slice(0,100));
}

function restore(){
  $$('.card').forEach(c=>{
    initCountdown(c);
    attachEnter(c);
    renderTools(c);
  });
  readStore().forEach(upsertCard);
}

// ===== モーダル =====
const backdrop=$('#backdrop');
const modalTitle=$('#modalTitle');
const mTitle=$('#mTitle'), mLimit=$('#mLimit'), mStart=$('#mStart'), mTarget=$('#mTarget');
const mStartFallback = $('#mStartFallback');
const mMonth = $('#mMonth'), mDay = $('#mDay'), mHour = $('#mHour'), mMinute = $('#mMinute');
const statusMsg=$('#statusMsg');
const submit=$('#submit'), duplicate=$('#duplicate'), delBtn=$('#delete');
const mFeeFree=$('#mFeeFree'), mFeePaid=$('#mFeePaid'), mFeeAmount=$('#mFeeAmount');

function updateFeeAmountState(){
  if (!mFeeAmount) return;
  const isPaid = mFeePaid && mFeePaid.checked;
  mFeeAmount.disabled = !isPaid;
  mFeeAmount.style.opacity = isPaid ? '1' : '0.5';
}

function setFeeControls(feeType, feeAmount){
  const type = feeType || 'free';
  const amount = (feeAmount || '').trim();
  if (mFeeFree && mFeePaid){
    mFeeFree.checked = type !== 'paid';
    mFeePaid.checked = type === 'paid';
  }
  if (mFeeAmount){
    mFeeAmount.value = amount;
  }
  updateFeeAmountState();
}

function getCurrentFee(){
  let type = 'free';
  if (mFeePaid && mFeePaid.checked) type = 'paid';
  const amount = (mFeeAmount && mFeeAmount.value || '').trim();
  return {
    feeType: type,
    feeAmount: type === 'paid' ? amount : ''
  };
}

if (mFeeFree) mFeeFree.addEventListener('change', updateFeeAmountState);
if (mFeePaid) mFeePaid.addEventListener('change', updateFeeAmountState);

// Quest / datetime-local 非対応検出
const isQuest = /\b(OculusBrowser|Meta Quest Browser|MetaQuestBrowser|Quest)\b/i.test(navigator.userAgent);
function supportsDateTimeLocal(){
  const i=document.createElement('input');
  i.setAttribute('type','datetime-local');
  return i.type === 'datetime-local';
}
const useFallback = isQuest || !supportsDateTimeLocal();

// フォールバック用（セレクト）の日付部品
let fallbackYear = new Date().getFullYear();
function populateDateSelects(){
  if (!mMonth || !mDay || !mHour || !mMinute) return;

  mMonth.innerHTML = '';
  for (let m=1;m<=12;m++){
    const opt=document.createElement('option');
    opt.value=String(m);
    opt.textContent=String(m);
    mMonth.appendChild(opt);
  }
  updateDayOptions(fallbackYear, 1, 1);

  mHour.innerHTML='';
  for (let h=0;h<24;h++){
    const opt=document.createElement('option');
    opt.value=String(h);
    opt.textContent=pad(h);
    mHour.appendChild(opt);
  }

  mMinute.innerHTML='';
  for (let mi=0;mi<60;mi+=10){
    const opt=document.createElement('option');
    opt.value=String(mi);
    opt.textContent=pad(mi);
    mMinute.appendChild(opt);
  }
}
function updateDayOptions(year, month, selectedDay){
  if (!mDay) return;
  mDay.innerHTML='';
  const last = new Date(year, month, 0).getDate();
  for (let d=1;d<=last;d++){
    const opt=document.createElement('option');
    opt.value=String(d);
    opt.textContent=String(d);
    if (d === selectedDay) opt.selected = true;
    mDay.appendChild(opt);
  }
}

function initStartInput(){
  const now = new Date();
  now.setMinutes(now.getMinutes()+10);
  now.setSeconds(0,0);

  if (!useFallback){
    if (mStart){
      mStart.style.display='';
      mStartFallback.style.display='none';
      mStart.value = toISO(now).slice(0,16);
    }
  }else{
    if (mStart){
      mStart.style.display='none';
    }
    if (mStartFallback){
      mStartFallback.style.display='grid';
    }
    fallbackYear = now.getFullYear();
    populateDateSelects();
    const monthNum = now.getMonth()+1;
    const dayNum   = now.getDate();
    const hourNum  = now.getHours();
    const minuteNum = Math.floor(now.getMinutes()/10)*10;
    mMonth.value = String(monthNum);
    updateDayOptions(fallbackYear, monthNum, dayNum);
    mDay.value   = String(dayNum);
    mHour.value  = String(hourNum);
    mMinute.value= String(minuteNum);
  }
}

let mode='create', editingRoomId=null, editingTarget=null;
function openModal(m='create', payload=null){
  mode=m;
  window.mode = m; // 言語適用時のボタン文言切り替え用
  statusMsg.style.display='none';
  statusMsg.textContent='';

  if(m==='create'){
    if (window.i18n && window.i18n.modal){
      modalTitle.textContent = window.i18n.modal.createTitle || 'Create meetup';
      submit.textContent = window.i18n.modal.submitCreate || 'Create meetup';
    }else{
      modalTitle.textContent='Create meetup';
      submit.textContent='Create meetup';
    }
    duplicate.style.display='none';
    delBtn.style.display='none';
    mTarget.disabled=false;
    mTitle.value='';
    mLimit.value='10';
    mTarget.value='';
    editingRoomId=null;
    editingTarget=null;
    setFeeControls('free','');
    initStartInput();
  }else{
    const owners=readOwners();
    if(!payload || !owners[payload.roomId]){
      const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.noPermission)
        || 'You do not have permission to edit this room on this device';
      alert(msg);
      return;
    }
    if (window.i18n && window.i18n.modal){
      modalTitle.textContent = window.i18n.modal.editTitle || 'Edit meetup';
      submit.textContent = window.i18n.modal.submitUpdate || 'Update';
    }else{
      modalTitle.textContent='Edit meetup';
      submit.textContent='Update';
    }
    duplicate.style.display='inline-block';
    delBtn.style.display='inline-block';
    mTarget.disabled=true;
    editingRoomId=payload.roomId;
    editingTarget=payload.target;
    mTitle.value=payload.title||'';
    mLimit.value=String(payload.limit||'10');
    setFeeControls(payload.feeType, payload.feeAmount);

    const d = new Date(payload.start||Date.now());
    if (useFallback){
      // セレクト版
      mStart.style.display='none';
      mStartFallback.style.display='grid';

      fallbackYear = d.getFullYear();
      populateDateSelects();

      const monthNum = d.getMonth()+1;
      const dayNum   = d.getDate();
      const hourNum  = d.getHours();
      let minuteNum  = d.getMinutes();
      minuteNum = Math.floor(minuteNum / 10) * 10;
      if (minuteNum >= 60) minuteNum = 50;

      mMonth.value = String(monthNum);
      updateDayOptions(fallbackYear, monthNum, dayNum);
      mDay.value   = String(dayNum);
      mHour.value  = String(hourNum);
      mMinute.value= String(minuteNum);
    }else{
      // datetime-local 版
      mStart.style.display='';
      mStartFallback.style.display='none';
      mStart.value=(payload.start||'').slice(0,16);
    }
    mTarget.value=payload.target||'';
  }
  backdrop.style.display='flex';
}
function closeModal(){ backdrop.style.display='none'; }

// ===== カスタムアラート =====
const alertBackdrop = $('#alertBackdrop');
const alertOk = $('#alertOk');
function showUrlAlert(){
  if (alertBackdrop){
    alertBackdrop.style.display = 'flex';
  }else{
    alert('Please enter a Dokodemo Doors URL.');
  }
}
if (alertOk && alertBackdrop){
  alertOk.addEventListener('click', ()=>{ alertBackdrop.style.display='none'; });
}

// ===== submit / delete / duplicate =====
async function onSubmit(){
  let roomId=editingRoomId, target=editingTarget;
  const title=(mTitle.value||'Meetup').trim();
  const limit=parseInt(mLimit.value,10)||10;
  const fee = getCurrentFee();

  const startISO = composeStartISO();
  if(!startISO){
    const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.startRequired)
      || 'Please enter the meeting time.';
    alert(msg);
    return;
  }

  if(mode==='create'){
    target=(mTarget.value||'').trim();

    /* dokodemodoors 以外は不可 → ポップアップ表示して中断 */
    if (!target.toLowerCase().startsWith('https://dokodemodoors.com/')) {
      showUrlAlert();
      return;
    }

    roomId=uuid();
    const ownersMap=readOwners();
    ownersMap[roomId]=randKey();
    writeOwners(ownersMap);
  }

  const prev = readStore().find(x=>x.roomId===roomId);
  const nowIso = new Date().toISOString();
  const item={
    roomId,
    title,
    start: startISO,
    limit: String(limit),
    target,
    feeType: fee.feeType,
    feeAmount: fee.feeAmount,
    updatedAt: nowIso,
    createdAt: prev?.createdAt || nowIso
  };

  upsertCard(item);
  persist(item);
  postRegistry(item);

  closeModal();

  if (window.i18n && window.i18n.modal){
    statusMsg.textContent = (mode==='create')
      ? (window.i18n.modal.statusCreated || 'Created')
      : (window.i18n.modal.statusUpdated || 'Updated');
  }else{
    statusMsg.textContent = (mode==='create') ? 'Created' : 'Updated';
  }
  statusMsg.style.display = 'block';
}

function onDuplicate(){
  if(!editingRoomId) return;
  const owners=readOwners();
  const newId=uuid();
  owners[newId]=randKey();
  writeOwners(owners);

  const startISO = composeStartISO() || new Date().toISOString();
  const nowIso = new Date().toISOString();
  const fee = getCurrentFee();
  const item={
    roomId:newId,
    title:(mTitle.value||'Meetup').trim(),
    start:startISO,
    limit:String(parseInt(mLimit.value,10)||10),
    target:editingTarget,
    feeType: fee.feeType,
    feeAmount: fee.feeAmount,
    updatedAt:nowIso,
    createdAt:nowIso
  };
  upsertCard(item);
  persist(item);
  postRegistry(item);
  const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.duplicated)
    || 'Duplicated. The destination URL is the same as the original.';
  alert(msg);
}

async function onDelete(){
  if(!editingRoomId) return;
  const owners=readOwners();
  const key = owners[editingRoomId];
  if (!key){
    const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.noPermission)
      || 'You do not have permission to delete this room on this device';
    alert(msg);
    return;
  }
  const ok = confirm('Delete this room?');
  if(!ok) return;

  autoDeleteRoom(editingRoomId);
  closeModal();
  statusMsg.textContent='Deleted';
  statusMsg.style.display='block';

  try{
    await fetch(REGISTRY_API, {
      method:'DELETE',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({ roomId: editingRoomId, ownerKey: key })
    });
  }catch(e){
    console.warn('[registry delete]', e);
  }
}

// ===== registry 送信 =====
async function postRegistry(item){
  try{
    const owner = localStorage.getItem('nickname') || null;
    const ownerKey = readOwners()[item.roomId] || null;
    await fetch(REGISTRY_API, {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({ roomId: item.roomId, title: item.title, start: item.start, limit: item.limit, target: item.target, owner, ownerKey, feeType: item.feeType, feeAmount: item.feeAmount })
    });
  }catch(e){ console.warn('[registry]', e); }
}

/**
 * 日時の組み立て
 * - PC: datetime-local の値をそのまま使う
 * - Quest 等: 年 + セレクト（月/日/時/分）から組み立てる
 * さらに、
 * - 「現在より過去」の日時の場合は、自動的に「翌年の同じ月日・時刻」に繰り上げる
 */
function composeStartISO(){
  const now = new Date();

  if (!useFallback){
    if (!mStart.value) return '';

    // mStart.value は "YYYY-MM-DDTHH:mm"
    const base = new Date(mStart.value);
    if (isNaN(base)) return '';

    // 「今日より過去なら翌年」に繰り上げ
    if (base < now){
      base.setFullYear(base.getFullYear()+1);
    }
    return base.toISOString();
  }

  // フォールバック側
  const month = parseInt(mMonth.value,10);
  const day   = parseInt(mDay.value,10);
  const hour  = parseInt(mHour.value,10);
  const minute= parseInt(mMinute.value,10);

  const base = new Date(fallbackYear, month-1, day, hour, minute, 0, 0);
  if (base < now){
    base.setFullYear(base.getFullYear()+1);
  }
  return base.toISOString();
}

// ===== イベント紐付け =====
(function(){
  $('#create').addEventListener('click', ()=>openModal('create'));
  $('#close').addEventListener('click', closeModal);
  $('#close2').addEventListener('click', closeModal);
  $('#submit').addEventListener('click', onSubmit);
  $('#delete').addEventListener('click', onDelete);
  $('#duplicate').addEventListener('click', onDuplicate);

  restore();
})();

// ===== ランダムキー =====
function randKey(){
  const arr=crypto.getRandomValues(new Uint8Array(16));
  return [...arr].map(x=>x.toString(16).padStart(2,'0')).join('');
}

// ===== i18n 読み込みと適用 =====
(function(){
  function updateHtmlLangAndDir(lang){
    document.documentElement.lang = lang;
    document.documentElement.dir =
      (lang === 'fa' || lang === 'he' || lang === 'ar') ? 'rtl' : 'ltr';
  }

  async function loadLanguage(lang){
    const res = await fetch(`./lang/${lang}.json`);
    if (!res.ok) return;
    const data = await res.json();
    window.i18n = data;

    // テキスト適用
    const t = data;
    if (t.titleText) $('.brand-logo-text').textContent = t.titleText;
    if (t.tagline) $('#tagline').textContent = t.tagline;
    if (t.visitSiteBtn) $('#visitSiteBtn').textContent = t.visitSiteBtn;
    if (t.aboutBtn) $('#aboutBtn').textContent = t.aboutBtn;
    if (t.guideBtn) $('#guideBtn').textContent = t.guideBtn;
    if (t.aboutTitle) $('#aboutTitle').textContent = t.aboutTitle;
    if (t.aboutLead) $('#aboutLead').textContent = t.aboutLead;
    if (t.meetupsTitle) $('#meetupsTitle').textContent = t.meetupsTitle;
    if (t.meetupsDescription) $('#meetupsDescription').textContent = t.meetupsDescription;

    if (t.modal){
      if (t.modal.createTitle) $('#modalTitle').textContent = t.modal.createTitle;
      if (t.modal.submitCreate && window.mode==='create') $('#submit').textContent = t.modal.submitCreate;
      if (t.modal.submitUpdate && window.mode==='edit') $('#submit').textContent = t.modal.submitUpdate;
      if (t.modal.titleLabel) $('label[for="mTitle"]').textContent = t.modal.titleLabel;
      if (t.modal.limitLabel) $('label[for="mLimit"]').textContent = t.modal.limitLabel;
      if (t.modal.startLabel) $('label[for="mStart"]').textContent = t.modal.startLabel;
      if (t.modal.targetLabel) $('label[for="mTarget"]').textContent = t.modal.targetLabel;
    }

    if (t.aboutModal){
      if (t.aboutModal.title) $('#aboutModalTitle').textContent = t.aboutModal.title;
      if (t.aboutModal.bodyHtml) $('#aboutBody').innerHTML = t.aboutModal.bodyHtml;
      if (t.aboutModal.ok) $('#aboutOk').textContent = t.aboutModal.ok;
    }

    if (t.guideModal){
      if (t.guideModal.title) $('#guideTitle').textContent = t.guideModal.title;
      if (t.guideModal.bodyHtml) $('#guideBody').innerHTML = t.guideModal.bodyHtml;
      if (t.guideModal.ok) $('#guideOk').textContent = t.guideModal.ok;
    }

    if (t.alertModal){
      if (t.alertModal.title) $('#alertTitle').textContent = t.alertModal.title;
      if (t.alertModal.body) $('#alertBody').textContent = t.alertModal.body;
      if (t.alertModal.ok) $('#alertOk').textContent = t.alertModal.ok;
    }

    if (t.meetups && t.meetups.cardStartsLabel){
      // 既存カードのラベルも更新
      $$('#grid .card').forEach(card=>{
        const span = card.querySelector('[data-countdown]');
        if (span){
          const text = span.textContent || '';
          const idx = text.indexOf(':');
          if (idx !== -1){
            const rest = text.slice(idx);
            span.textContent = `${t.meetups.cardStartsLabel}${rest}`;
          }
        }
        const feeEl = card.querySelector('[data-fee]');
        if (feeEl){
          const item = {
            feeType: card.dataset.feeType || 'free',
            feeAmount: card.dataset.feeAmount || ''
          };
          feeEl.textContent = formatFeeLabel(item);
        }
      });
    }

    // 言語ラベル
    const labelMap = (t.langLabelMap || {
      en: 'English',
      ja: '日本語',
      zh: '中文',
      fa: 'فارسی',
      hi: 'हिन्दी',
      he: 'עברית'
    });
    const currentLangLabel = labelMap[lang] || 'Language';
    $('#currentLangLabel').textContent = currentLangLabel;
  }

  // 言語スイッチ UI
  (function setupLangSwitch(){
    const current = $('#currentLangLabel');
    const dropdown = $('#langDropdown');
    if (!current || !dropdown) return;

    current.addEventListener('click', ()=>{
      const open = dropdown.getAttribute('data-open') === 'true';
      dropdown.setAttribute('data-open', open ? 'false' : 'true');
    });

    document.addEventListener('click', (e)=>{
      if (!dropdown.contains(e.target) && e.target !== current){
        dropdown.setAttribute('data-open', 'false');
      }
    });

    dropdown.querySelectorAll('button[data-lang]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const lang = btn.getAttribute('data-lang');
        if (!lang) return;
        window.currentLang = lang;
        try{
          localStorage.setItem('lang', lang);
        }catch(e){}
        updateHtmlLangAndDir(lang);
        loadLanguage(lang);
        dropdown.setAttribute('data-open', 'false');
      });
    });
  })();

  // 初期言語
  let appStarted = false;
  window.addEventListener('DOMContentLoaded', ()=>{
    let stored = null;
    try{
      stored = localStorage.getItem('lang');
    }catch(e){}
    const initial = stored || 'en';
    window.currentLang = initial;
    updateHtmlLangAndDir(initial);
    loadLanguage(initial).finally(function(){
      if (!appStarted && typeof window.startApp === 'function'){
        appStarted = true;
        window.startApp();
      }
    });
  });
})();
