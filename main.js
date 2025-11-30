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
  const off=-d.getTimezoneOffset();
  const sign=off>=0?'+':'-';
  const a=Math.abs(off);
  return local+`${sign}${pad(Math.floor(a/60))}:${pad(a%60)}`;
};
const uuid=()=> (crypto.randomUUID?.() || ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g,c=>(c^crypto.getRandomValues(new Uint8Array(1))[0]&15>>c/4).toString(16)));
const randKey=(n=16)=>{
  const a=new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map(x=>x.toString(16).padStart(2,'0')).join('');
};

// ===== Storage =====
const S='meetups-store', O='meetups-owners';
const readStore =()=>JSON.parse(localStorage.getItem(S)||'[]'
)||[];

const writeStore=(arr)=>localStorage.setItem(S,JSON.stringify(arr));
const readOwners = () => JSON.parse(localStorage.getItem(O) || "{}");
const writeOwners = (map) => localStorage.setItem(O, JSON.stringify(map));

// ===== カウントダウン =====
function initCountdown(card){
  const span=card.querySelector('[data-countdown]');
  if(!span) return;
  const start=card.dataset.start;
  if(!start) return;

  function tick(){
    const now=Date.now();
    const t=new Date(start).getTime()-now;
    if(t<=0){
      span.textContent=(window.i18n?.meetups?.cardStartedLabel || 'Started');
      return;
    }
    const h=Math.floor(t/3600000);
    const m=Math.floor(t/60000)%60;
    const s=Math.floor(t/1000)%60;
    span.textContent=
      (window.i18n?.meetups?.cardStartsLabel || 'Starts in')
      +` ${pad(h)}:${pad(m)}:${pad(s)}`;
    requestAnimationFrame(tick);
  }
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
      lang  : currentLang,
      feeType: card.dataset.feeType || 'free',
      feeAmount: card.dataset.feeAmount || ''
    });
    location.href = `./lobby.html?${p.toString()}`;
  };
}

function renderTools(card){
  const roomId=card.dataset.roomId;
  if(!roomId) return;
  const tools=card.querySelector('.tools')||(()=>{
    const div=document.createElement('div');
    div.className='tools';
    const edit=document.createElement('button');
    edit.type='button';
    edit.className='link';
    edit.textContent=(window.i18n?.meetups?.editLabel || 'Edit');
    edit.dataset.tool='edit';
    const copy=document.createElement('button');
    copy.type='button';
    copy.className='link';
    copy.textContent=(window.i18n?.meetups?.copyUrlLabel || 'Copy URL');
    copy.dataset.tool='copy';
    div.append(edit,copy);
    card.appendChild(div);
    return div;
  })();

  tools.querySelectorAll('button').forEach(b=>{
    const t=b.dataset.tool;
    if(t==='edit'){
      b.onclick=()=>openModal('edit', {
        roomId,
        title: card.dataset.title,
        start: card.dataset.start,
        limit: card.dataset.limit,
        target: card.dataset.url,
        feeType: card.dataset.feeType || 'free',
        feeAmount: card.dataset.feeAmount || ''
      });
    }else if(t==='copy'){
      b.onclick=async()=>{
        try{
          await navigator.clipboard.writeText(location.origin+location.pathname.replace(/[^/]+$/,'')+`lobby.html?roomId=${encodeURIComponent(roomId)}`);
          alert((window.i18n?.meetups?.copiedLabel || 'Copied.'));
        }catch(e){
          alert((window.i18n?.meetups?.copyFailedLabel || 'Copy failed. Please copy manually.'));
        }
      };
    }
  });
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
      <div class="meta fee-meta" data-fee></div>
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
  card.dataset.feeAmount = (item.feeAmount || '').trim();
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
const mFeeFree=$('#mFeeFree'), mFeePaid=$('#mFeePaid'), mFeeAmount=$('#mFeeAmount');
const mStartFallback = $('#mStartFallback');
const mMonth = $('#mMonth'), mDay = $('#mDay'), mHour = $('#mHour'), mMinute = $('#mMinute');
const statusMsg=$('#statusMsg');
const submit=$('#submit'), duplicate=$('#duplicate'), delBtn=$('#delete');

function updateFeeAmountState(){
  if (!mFeeAmount) return;
  const isPaid = mFeePaid && mFeePaid.checked;
  mFeeAmount.disabled = !isPaid;
  mFeeAmount.style.opacity = isPaid ? '1' : '0.5';
}

if (mFeeFree) mFeeFree.addEventListener('change', updateFeeAmountState);
if (mFeePaid) mFeePaid.addEventListener('change', updateFeeAmountState);

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

// Quest / datetime-local 非対応検出
const isQuest = /\b(OculusBrowser|Meta Quest Browser|MetaQuestBrowser|Quest)\b/i.test(navigator.userAgent);
function supportsDateTimeLocal(){
  const i=document.createElement('input');
  i.setAttribute('type','datetime-local');
  return i.type === 'datetime-local';
}
const useFallback = isQuest || !supportsDateTimeLocal();

// フォールバック用（セレクト）の年情報
let fallbackYear = new Date().getFullYear();

function daysInMonth(year, month){
  // month: 1〜12
  return new Date(year, month, 0).getDate();
}

function populateDateSelects(){
  if (!mMonth || !mDay || !mHour || !mMinute) return;

  mMonth.innerHTML = '';
  for (let i = 1; i <= 12; i++){
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    mMonth.appendChild(opt);
  }

  updateDayOptions(fallbackYear, parseInt(mMonth.value || '1', 10), null);

  mHour.innerHTML = '';
  for (let i = 0; i < 24; i++){
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = pad(i);
    mHour.appendChild(opt);
  }

  mMinute.innerHTML = '';
  for (let i = 0; i < 60; i += 10){
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = pad(i);
    mMinute.appendChild(opt);
  }
}

function updateDayOptions(year, month, selectedDay){
  if (!mDay) return;
  const maxDay = daysInMonth(year, month);
  const prev = parseInt(mDay.value || '1', 10);
  mDay.innerHTML = '';
  for (let i = 1; i <= maxDay; i++){
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = String(i);
    mDay.appendChild(opt);
  }
  if (selectedDay && selectedDay <= maxDay){
    mDay.value = String(selectedDay);
    return;
  }
  const clamped = Math.min(prev, maxDay);
  mDay.value = String(clamped);
}

function initStartInput(){
  const now=new Date();
  now.setMinutes(now.getMinutes()+30);
  now.setSeconds(0,0);
  const yyyy=now.getFullYear(), mm=pad(now.getMonth()+1), dd=pad(now.getDate());
  const hh=pad(now.getHours()), mi=pad(now.getMinutes());

  if (useFallback){
    // Quest 等: 月/日/時/分 セレクトを使用
    mStart.style.display='none';
    mStartFallback.style.display='grid';

    fallbackYear = now.getFullYear();
    populateDateSelects();

    const monthNum = now.getMonth()+1;
    const dayNum   = now.getDate();
    const hourNum  = now.getHours();
    let minuteNum  = now.getMinutes();
    minuteNum = Math.ceil(minuteNum / 10) * 10;
    if (minuteNum >= 60) minuteNum = 50;

    mMonth.value = String(monthNum);
    updateDayOptions(fallbackYear, monthNum, dayNum);
    mHour.value = String(hourNum);
    mMinute.value = String(minuteNum);
  }else{
    // datetime-local が使える場合
    mStart.style.display='';
    mStartFallback.style.display='none';
    mStart.value = `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }
}

if (mMonth){
  mMonth.addEventListener('change', ()=>{
    const year = fallbackYear || new Date().getFullYear();
    const month = parseInt(mMonth.value || '1', 10);
    updateDayOptions(year, month, parseInt(mDay.value || '1', 10));
  });
}

// openModal / closeModal
let mode='create';
let editingRoomId=null;
let editingTarget=null;

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
      const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.ownerMissing)
        || 'Owner information is missing on this device, so the room cannot be edited.';
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
    duplicate.style.display='';
    delBtn.style.display='';
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
      mHour.value = String(hourNum);
      mMinute.value = String(minuteNum);
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
const alertClose = $('#alertClose');
const alertOk = $('#alertOk');
function showUrlAlert(){
  if(alertBackdrop){ alertBackdrop.style.display='flex'; }
}
function hideUrlAlert(){
  if(alertBackdrop){ alertBackdrop.style.display='none'; }
}
if(alertClose) alertClose.onclick = hideUrlAlert;
if(alertOk) alertOk.onclick = hideUrlAlert;

// ===== サイト説明モーダル =====
const aboutBackdrop = $('#aboutBackdrop');
const aboutBtn = $('#aboutBtn');
const aboutClose = $('#aboutClose');
const aboutOk = $('#aboutOk');
function openAbout(){
  if (aboutBackdrop) aboutBackdrop.style.display = 'flex';
}
function closeAboutModal(){
  if (aboutBackdrop) aboutBackdrop.style.display = 'none';
}
if (aboutBtn) aboutBtn.onclick = openAbout;
if (aboutClose) aboutClose.onclick = closeAboutModal;
if (aboutOk) aboutOk.onclick = closeAboutModal;

// ===== How to use Meetup Rooms モーダル =====
const howtoBackdrop = $('#howtoBackdrop');
const howtoBtn      = $('#howtoBtn');
const howtoClose    = $('#howtoClose');
const howtoOk       = $('#howtoOk');
function openHowto(){
  if (howtoBackdrop) howtoBackdrop.style.display = 'flex';
}
function closeHowtoModal(){
  if (howtoBackdrop) howtoBackdrop.style.display = 'none';
}
if (howtoBtn) howtoBtn.onclick = openHowto;
if (howtoClose) howtoClose.onclick = closeHowtoModal;
if (howtoOk) howtoOk.onclick = closeHowtoModal;

// ===== レジストリ API =====
const REGISTRY_API = "https://dokodemodoors-fan-site-worker.pages.dev/api/meetups";

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
    // datetime-local の値をそのまま使う
    if (!mStart || !mStart.value) return "";
    const base = new Date(mStart.value);
    if (isNaN(base.getTime())) return "";

    // 過去なら翌年に繰り上げ
    if (base < now){
      base.setFullYear(base.getFullYear() + 1);
    }

    const y  = base.getFullYear();
    const mo = pad(base.getMonth() + 1);
    const d  = pad(base.getDate());
    const h  = pad(base.getHours());
    const mi = pad(base.getMinutes());
    const localFixed = `${y}-${mo}-${d}T${h}:${mi}`;
    return toISO(localFixed);
  }

  // フォールバック（Quest 等）の場合：
  // fallbackYear + セレクトから Date を作り、過去なら翌年に繰り上げ
  const baseYear = fallbackYear || now.getFullYear();
  let month = parseInt(mMonth.value || '0', 10) || 1;
  let day   = parseInt(mDay.value   || '0', 10) || 1;
  let hour  = parseInt(mHour.value  || '0', 10) || 0;
  let min   = parseInt(mMinute.value|| '0', 10) || 0;

  // 月・日を一応 1〜12 / 1〜31 の範囲にクリップしてから Date を作成
  month = Math.min(Math.max(month, 1), 12);
  day   = Math.min(Math.max(day,   1), 31);

  let dObj = new Date(baseYear, month - 1, day, hour, min);
  if (isNaN(dObj.getTime())) return '';

  // 過去なら翌年に繰り上げ
  if (dObj < now){
    dObj.setFullYear(dObj.getFullYear() + 1);
  }

  const y2  = dObj.getFullYear();
  const mo2 = pad(dObj.getMonth() + 1);
  const d2  = pad(dObj.getDate());
  const h2  = dObj.getHours().toString().padStart(2,'0');
  const mi2 = dObj.getMinutes().toString().padStart(2,'0');

  return toISO(`${y2}-${mo2}-${d2}T${h2}:${mi2}`);
}

async function onSubmit(){
  let roomId=editingRoomId, target=editingTarget;
  const title=(mTitle.value||'Meetup').trim();
  const limit=parseInt(mLimit.value,10)||10;

  const startISO = composeStartISO();
  if(!startISO){
    const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.startRequired)
      || 'Please enter the meeting time.';
    alert(msg);
    return;
  }

  const fee = getCurrentFee();

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

  if (window.i18n && window.i18n.modal && window.i18n.modal.validation){
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

  const fee = getCurrentFee();

  const startISO = composeStartISO() || new Date().toISOString();
  const nowIso = new Date().toISOString();
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
  try{
    const ownerKey = readOwners()[editingRoomId];
    if (!ownerKey){
      const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.ownerMissing)
        || 'Owner information is missing on this device, so the room cannot be deleted.';
      alert(msg);
      return;
    }
    const res = await fetch(REGISTRY_API, {
      method: "DELETE",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({ roomId: editingRoomId, ownerKey })
    });
    if (!res.ok){
      const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.deleteFailed)
        || 'Failed to delete the room. Please try again.';
      alert(msg);
      return;
    }
    const remain=readStore().filter(x=>x.roomId!==editingRoomId);
    writeStore(remain);
    const ownersMap=readOwners();
    delete ownersMap[editingRoomId];
    writeOwners(ownersMap);
    restore();
    closeModal();
  }catch(e){
    console.error(e);
    const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.deleteFailed)
      || 'Failed to delete the room. Please try again.';
    alert(msg);
  }
}

// ===== イベント登録 =====
document.addEventListener('DOMContentLoaded', ()=>{
  restore();
  $('#open')?.addEventListener('click',()=>openModal('create'));
  $('#close')?.addEventListener('click',closeModal);
  $('#close2')?.addEventListener('click',closeModal);
  submit?.addEventListener('click',onSubmit);
  duplicate?.addEventListener('click',onDuplicate);
  delBtn?.addEventListener('click',onDelete);
});

// ===== 言語切り替え（i18n） =====
let currentLang = 'en';  // デフォルト
let appStarted = false;

const LANGUAGE_LABELS = {
  en: 'English',
  ja: '日本語',
  zh: '中文',
  fa: 'فارسی',
  hi: 'हिन्दी',
  he: 'עברית'
};

function updateHtmlLangAndDir(lang){
  const root = document.documentElement;
  root.lang = lang || 'en';
  if (lang === 'fa' || lang === 'he'){
    root.dir = 'rtl';
  }else{
    root.dir = 'ltr';
  }
}

async function loadLanguage(lang){
  const files = window.LANG_FILES || {};
  const url = files[lang] || files['en'];
  if (!url) return null;
  const res = await fetch(url);
  if (!res.ok) return null;
  return await res.json();
}

function applyLanguageDict(dict){
  if (!dict) return;

  // Hero / header
  if (dict.hero){
    $('#siteTitle').textContent = dict.hero.title || $('#siteTitle').textContent;
    $('#siteLead').textContent = dict.hero.lead || $('#siteLead').textContent;
    $('#heroOverlayText').innerHTML = dict.hero.overlay || $('#heroOverlayText').innerHTML;
    $('#officialSiteBtn').textContent = dict.hero.officialSiteBtn || $('#officialSiteBtn').textContent;
    $('#aboutBtn').textContent = dict.hero.aboutBtn || $('#aboutBtn').textContent;
    $('#howtoBtn').textContent = dict.hero.howtoBtn || $('#howtoBtn').textContent;
  }

  // Description
  if (dict.description){
    $('#descriptionTitle').textContent = dict.description.title || $('#descriptionTitle').textContent;
    $('#descriptionBody').textContent = dict.description.body || $('#descriptionBody').textContent;
  }

  // Meetups
  if (dict.meetups){
    $('#meetupsTitle').textContent = dict.meetups.title || $('#meetupsTitle').textContent;
    $('#meetupsLead').textContent = dict.meetups.lead || $('#meetupsLead').textContent;
    $('#open').textContent = dict.meetups.createBtn || $('#open').textContent;
    window.i18n = window.i18n || {};
    window.i18n.meetups = dict.meetups;
    restore();
  }

  // Notes
  if (dict.notes){
    $('#notesTitle').textContent = dict.notes.title || $('#notesTitle').textContent;
    const list = $('#notesList');
    if (Array.isArray(dict.notes.items) && list){
      list.innerHTML = '';
      dict.notes.items.forEach((txt)=>{
        const li = document.createElement('li');
        li.textContent = txt;
        list.appendChild(li);
      });
    }
  }

  // Modal
  if (dict.modal){
    window.i18n = window.i18n || {};
    window.i18n.modal = dict.modal;

    if (mode === 'create'){
      $('#modalTitle').textContent = dict.modal.createTitle || $('#modalTitle').textContent;
      submit.textContent = dict.modal.submitCreate || submit.textContent;
    }else{
      $('#modalTitle').textContent = dict.modal.editTitle || $('#modalTitle').textContent;
      submit.textContent = dict.modal.submitUpdate || submit.textContent;
    }

    $('#delete').textContent = dict.modal.deleteBtn || $('#delete').textContent;
    $('#duplicate').textContent = dict.modal.duplicateBtn || $('#duplicate').textContent;
    $('#close2').textContent = dict.modal.closeBtn || $('#close2').textContent;

    $('#alertTitle').textContent = dict.modal.alertTitle || $('#alertTitle').textContent;
    $('#alertBody').textContent = dict.modal.alertBody || $('#alertBody').textContent;
    $('#alertOk').textContent = dict.modal.alertOk || $('#alertOk').textContent;

    $('#aboutTitle').textContent = dict.modal.aboutTitle || $('#aboutTitle').textContent;
    $('#aboutOk').textContent = dict.modal.aboutOk || $('#aboutOk').textContent;

    $('#howtoTitle').textContent = dict.modal.howtoTitle || $('#howtoTitle').textContent;
    $('#howtoOk').textContent = dict.modal.howtoOk || $('#howtoOk').textContent;
  }
}

async function initAppLanguage(){
  if (appStarted) return;
  appStarted = true;

  try{
    const stored = localStorage.getItem('lang');
    if (stored && LANGUAGE_LABELS[stored]){
      currentLang = stored;
    }else{
      const navLang = (navigator.language || 'en').slice(0,2);
      if (LANGUAGE_LABELS[navLang]){
        currentLang = navLang;
      }
    }
  }catch(e){}

  updateHtmlLangAndDir(currentLang);
  const dict = await loadLanguage(currentLang);
  applyLanguageDict(dict);
}

function updateLanguageToggleLabel(){
  const btn = document.getElementById('langToggle');
  if (!btn) return;
  const label = LANGUAGE_LABELS[currentLang] || 'Language';
  btn.textContent = label;
}

async function changeLanguage(lang){
  if (!LANGUAGE_LABELS[lang]) return;
  currentLang = lang;
  try{
    localStorage.setItem('lang', lang);
  }catch(e){}
  updateHtmlLangAndDir(lang);
  const dict = await loadLanguage(lang);
  applyLanguageDict(dict);
  updateLanguageToggleLabel();
}

document.addEventListener('DOMContentLoaded', ()=>{
  initAppLanguage().then(updateLanguageToggleLabel);

  const toggle = document.getElementById('langToggle');
  const menu   = document.getElementById('langMenu');
  if (!toggle || !menu) return;

  toggle.addEventListener('click', ()=>{
    const isHidden = menu.hasAttribute('hidden');
    if (isHidden){
      menu.removeAttribute('hidden');
    }else{
      menu.setAttribute('hidden', 'hidden');
    }
  });

  document.addEventListener('click', (ev)=>{
    if (!menu || !toggle) return;
    if (!menu.contains(ev.target) && ev.target !== toggle){
      menu.setAttribute('hidden', 'hidden');
    }
  });

  menu.querySelectorAll('button[data-lang]').forEach(btn=>{
    btn.addEventListener('click', (ev)=>{
      const lang = ev.currentTarget.getAttribute('data-lang');
      changeLanguage(lang);
      menu.setAttribute('hidden', 'hidden');
    });
  });
});
