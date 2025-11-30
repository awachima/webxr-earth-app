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
  const remain = readStore().filter(x=>x.roomId!==roomId);
  writeStore(remain);
  const owners = readOwners(); delete owners[roomId]; writeOwners(owners);
  const c = document.querySelector(`.card[data-room-id="${roomId}"]`);
  if (c) c.remove();
  console.info('[auto-delete]', roomId, 'deleted (20 minutes after start)');
}

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
      roomId   : card.dataset.roomId || '',
      title    : card.dataset.title,
      start    : card.dataset.start,
      limit    : card.dataset.limit,
      target   : card.dataset.url,
      lang     : currentLang,
      eventType: card.dataset.eventType || 'free',
      price    : card.dataset.price || ''
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
      eventType: card.dataset.eventType || 'free',
      price: card.dataset.price || ''
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
      <div class="event-type" data-event-type></div>
      <div class="meta"><span data-countdown>${startLabel}: --:--:--</span></div>
      <div><a class="btn" data-enter>${enterLabel}</a></div>`;
  }
  card.dataset.roomId=item.roomId;
  card.dataset.title=item.title;
  card.querySelector('.title').textContent=item.title;
  card.dataset.start=item.start;
  card.dataset.url=item.target;
  card.dataset.limit=item.limit;
  // イベント種別と金額も data-* に保存
  card.dataset.eventType = item.eventType || 'free';
  card.dataset.price     = (item.price ?? '').toString();

  // ★ イベント種別表示文言
  const etEl = card.querySelector('[data-event-type]');
  if (etEl){
    const type  = item.eventType || 'free';
    const price = (item.price ?? '').toString().trim();
    let label = '';
    if (type === 'paid'){
      label = price ? `Paid event (${price})` : 'Paid event';
    } else {
      label = 'Free event';
    }
    etEl.textContent = label;
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

// Free/Paid ラジオ＋金額入力
const mEventTypeRadios = document.querySelectorAll("input[name='mEventType']");
const mPrice = $('#mPrice');
const priceWrapper = $('#priceWrapper');

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

  if (!mMonth.options.length){
    for (let i=1;i<=12;i++){
      const opt=document.createElement('option');
      opt.value=String(i);
      opt.textContent=String(i);
      mMonth.appendChild(opt);
    }
  }
  if (!mHour.options.length){
    for (let h=0;h<24;h++){
      const opt=document.createElement('option');
      opt.value=String(h);
      opt.textContent=pad(h);
      mHour.appendChild(opt);
    }
  }
  if (!mMinute.options.length){
    for (let m=0;m<60;m+=10){
      const opt=document.createElement('option');
      opt.value=String(m);
      opt.textContent=pad(m);
      mMinute.appendChild(opt);
    }
  }
}

function updateDayOptions(year, month, currentDay){
  if (!mDay) return;
  const maxDay = daysInMonth(year, month || 1);
  const prev = currentDay || parseInt(mDay.value || '1',10) || 1;

  while (mDay.firstChild){
    mDay.removeChild(mDay.firstChild);
  }
  for (let d=1; d<=maxDay; d++){
    const opt=document.createElement('option');
    opt.value=String(d);
    opt.textContent=String(d);
    mDay.appendChild(opt);
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
    // PC など: datetime-local を使用
    mStart.style.display='';
    mStartFallback.style.display='none';
    mStart.value=`${yyyy}-${mm}-${dd}T${hh}:${mi}`;
  }
}

// EventType + Price UI
function setEventTypeInModal(type, price){
  const val = (type === 'paid') ? 'paid' : 'free';
  if (mEventTypeRadios && mEventTypeRadios.length){
    mEventTypeRadios.forEach(r=>{
      r.checked = (r.value === val);
    });
  }
  if (priceWrapper && mPrice){
    if (val === 'paid'){
      priceWrapper.style.display = 'block';
      if (price !== undefined && price !== null){
        mPrice.value = String(price);
      }
    }else{
      priceWrapper.style.display = 'none';
      mPrice.value = '';
    }
  }
}

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
    initStartInput();
    // 新規作成時は無料扱い＆Price 非表示
    setEventTypeInModal('free', '');
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

    // 既存データの種別・金額を反映（無ければ free）
    const existingType  = payload.eventType || 'free';
    const existingPrice = payload.price || '';
    setEventTypeInModal(existingType, existingPrice);
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
if (aboutBtn)   aboutBtn.onclick   = openAbout;
if (aboutClose) aboutClose.onclick = closeAboutModal;
if (aboutOk)    aboutOk.onclick    = closeAboutModal;

// ===== Meetup Rooms の使い方モーダル =====
const guideBackdrop = $('#guideBackdrop');
const guideBtn = $('#guideBtn');
const guideClose = $('#guideClose');
const guideOk = $('#guideOk');
function openGuide(){
  if (guideBackdrop) guideBackdrop.style.display = 'flex';
}
function closeGuideModal(){
  if (guideBackdrop) guideBackdrop.style.display = 'none';
}
if (guideBtn)   guideBtn.onclick   = openGuide;
if (guideClose) guideClose.onclick = closeGuideModal;
if (guideOk)    guideOk.onclick    = closeGuideModal;

async function postRegistry(item){
  try{
    const owner = localStorage.getItem('nickname') || null;
    const ownerKey = readOwners()[item.roomId] || null;
    await fetch(REGISTRY_API, {
      method: "POST",
      headers: {"content-type":"application/json"},
      body: JSON.stringify({
        roomId: item.roomId,
        title: item.title,
        start: item.start,
        limit: item.limit,
        target: item.target,
        owner,
        ownerKey,
        eventType: item.eventType || 'free',
        price: item.price ?? ''
      })
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
    if (isNaN(base.getTime())) return '';

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

  // イベント種別と金額取得
  let eventType = 'free';
  if (mEventTypeRadios && mEventTypeRadios.length){
    const checked = Array.from(mEventTypeRadios).find(r=>r.checked);
    if (checked && checked.value === 'paid') eventType = 'paid';
  }
  let price = '';
  if (eventType === 'paid' && mPrice && mPrice.value){
    price = mPrice.value.trim();
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
    updatedAt: nowIso,
    createdAt: prev?.createdAt || nowIso,
    eventType,
    price
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

  const startISO = composeStartISO() || new Date().toISOString();
  const nowIso = new Date().toISOString();

  // 現在モーダルに入っている種別と金額を取得して複製にも反映
  let eventType = 'free';
  if (mEventTypeRadios && mEventTypeRadios.length){
    const checked = Array.from(mEventTypeRadios).find(r=>r.checked);
    if (checked && checked.value === 'paid') eventType = 'paid';
  }
  let price = '';
  if (eventType === 'paid' && mPrice && mPrice.value){
    price = mPrice.value.trim();
  }

  const item={
    roomId:newId,
    title:(mTitle.value||'Meetup').trim(),
    start:startISO,
    limit:String(parseInt(mLimit.value,10)||10),
    target:editingTarget,
    updatedAt:nowIso,
    createdAt:nowIso,
    eventType,
    price
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
      method:"DELETE",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({ roomId: editingRoomId, ownerKey })
    });
    if (!res.ok){
      const data = await res.json().catch(()=>({}));
      const prefix = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.deleteFailedPrefix)
        || 'Failed to delete';
      alert(`${prefix}: ${data.error || res.statusText}`);
      return;
    }
  }catch(e){
    const msg = (window.i18n && window.i18n.modal && window.i18n.modal.validation && window.i18n.modal.validation.serverError)
      || 'An error occurred while connecting to the server.';
    alert(msg);
    console.warn('[registry DELETE]', e);
    return;
  }
  autoDeleteRoom(editingRoomId);
  closeModal();
}

// 共有部屋一覧の読み込み
async function loadShared(){
  try{
    const res = await fetch(REGISTRY_API);
    const j = await res.json();
    if (j && j.ok && Array.isArray(j.rooms)){
      const remoteRoomIds = new Set(j.rooms.map(r=>r.roomId));
      document.querySelectorAll('#grid .card').forEach(card=>{
        const roomId = card.dataset.roomId;
        if (roomId && !remoteRoomIds.has(roomId)) card.remove();
      });
      j.rooms.forEach(upsertCard);
    }
  }catch(e){
    console.warn('[registry GET]', e);
  }
}

// ===== 初期化（言語読み込み後に startApp() から呼び出す） =====
function startApp(){
  restore();

  // 月変更時に日付の上限を月に合わせてクランプ
  if (mMonth && mDay){
    mMonth.addEventListener('change', ()=>{
      const year = fallbackYear || new Date().getFullYear();
      const currentDay = parseInt(mDay.value || '1',10) || 1;
      const monthNum   = parseInt(mMonth.value || '1',10) || 1;
      updateDayOptions(year, monthNum, currentDay);
    });
  }

  // EventType ラジオの挙動（paid で Price 表示）
  if (mEventTypeRadios && mEventTypeRadios.length){
    mEventTypeRadios.forEach(r=>{
      r.addEventListener('change', ()=>{
        if (!r.checked) return;
        const newType = (r.value === 'paid') ? 'paid' : 'free';
        setEventTypeInModal(newType, mPrice ? mPrice.value : '');
      });
    });
    // 起動時は free
    setEventTypeInModal('free', '');
  }

  // タイトル右の作成ボタン
  const oc = document.getElementById('openCreate');
  if (oc) oc.onclick = () => openModal('create');

  // 読み込み直後は確実に非表示（チラ見え対策）
  closeModal();

  document.getElementById('close').onclick=closeModal;
  document.getElementById('close2').onclick=closeModal;
  document.getElementById('submit').onclick=onSubmit;
  document.getElementById('duplicate').onclick=onDuplicate;
  document.getElementById('delete').onclick=onDelete;

  loadShared();
  setInterval(loadShared, 30000);
}

// （将来用）管理者パスワード関連
const ADMIN_HASH="27362e4fcff362576da78138fe5383a75fe64f66dcfd1e7b9e850504b845a5f4";
function toHex(buf){return[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,"0")).join("");}
async function sha256(s){
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return toHex(buf);
}
function subtleEqual(a,b){if(a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}

// ===== iframe ホバー時のスクロールロック =====
(function(){
  var iframe = document.getElementById('webxr-iframe');
  if(!iframe) return;

  function lockPageScroll(){ document.documentElement.style.overflowY = 'hidden'; }
  function unlockPageScroll(){ document.documentElement.style.overflowY = ''; }

  iframe.addEventListener('mouseenter', lockPageScroll);
  iframe.addEventListener('mouseleave', unlockPageScroll);
  window.addEventListener('blur', unlockPageScroll);
  window.addEventListener('beforeunload', unlockPageScroll);
})();

// ===== 言語切り替え（外部 JSON 読み込み） =====
(function(){
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
    } else {
      root.dir = 'ltr';
    }
  }

  async function loadLanguage(lang){
    let data = {};
    try{
      const res = await fetch('./lang/' + lang + '.json');
      if (!res.ok) throw new Error('Failed to load language: ' + lang);
      data = await res.json();
    }catch(e){
      console.error(e);
      // 読み込み失敗時は既存の window.i18n をそのまま使う
      data = window.i18n || {};
    }
    window.i18n = data || {};
    window.currentLang = lang;
    try{ localStorage.setItem('lang', lang); }catch(e){}
    updateHtmlLangAndDir(lang);
    applyLanguage();
  }

  function applyLanguage(){
    const t = window.i18n || {};
    const current = window.currentLang || 'en';

    // ページタイトル
    if (t.pageTitle){
      document.title = t.pageTitle;
    }

    // ヘッダーロゴテキスト
    const siteTitleEl = document.querySelector('.brand-logo-text');
    if (siteTitleEl){
      siteTitleEl.textContent = t.siteTitle || 'Dokodemo Doors Fan Site';
    }

    // 上部ボタン
    if (t.buttons){
      const aboutBtn = document.getElementById('aboutBtn');
      const guideBtn = document.getElementById('guideBtn');
      if (aboutBtn && t.buttons.about) aboutBtn.textContent = t.buttons.about;
      if (guideBtn && t.buttons.guide) guideBtn.textContent = t.buttons.guide;
    }

    // About モーダル
    if (t.about){
      const aboutTitle = document.getElementById('aboutTitle');
      const aboutBody  = document.getElementById('aboutBody');
      if (aboutTitle && t.about.title) aboutTitle.textContent = t.about.title;
      if (aboutBody && t.about.bodyHtml) aboutBody.innerHTML = t.about.bodyHtml;
    }
    if (t.aboutModal && t.aboutModal.ok){
      const aboutOk = document.getElementById('aboutOk');
      if (aboutOk) aboutOk.textContent = t.aboutModal.ok;
    }

    // Guide モーダル
    if (t.guide){
      const guideTitle = document.getElementById('guideTitle');
      const guideBody  = document.getElementById('guideBody');
      if (guideTitle && t.guide.title) guideTitle.textContent = t.guide.title;
      if (guideBody && t.guide.bodyHtml) guideBody.innerHTML = t.guide.bodyHtml;
    }
    if (t.guideModal && t.guideModal.ok){
      const guideOk = document.getElementById('guideOk');
      if (guideOk) guideOk.textContent = t.guideModal.ok;
    }

    // Meetup Rooms ヘッダー
    if (t.meetups){
      const meetupsTitle = document.querySelector('.meetups__title');
      const createBtn = document.getElementById('openCreate');
      if (meetupsTitle && t.meetups.title) meetupsTitle.textContent = t.meetups.title;
      if (createBtn && t.meetups.createButton) createBtn.textContent = t.meetups.createButton;

      // カード内の Enter Lobby ボタン
      if (t.meetups.enterLobby){
        document.querySelectorAll('#grid .card [data-enter]').forEach(btn=>{
          btn.textContent = t.meetups.enterLobby;
        });
      }

      // カウントダウン表示のラベル部分だけ差し替え
      if (t.meetups.cardStartsLabel){
        document.querySelectorAll('#grid .card [data-countdown]').forEach(span=>{
          const txt = span.textContent || '';
          const m = txt.match(/: (.*)$/);
          const suffix = m ? m[1] : '--:--:--';
          span.textContent = `${t.meetups.cardStartsLabel}: ${suffix}`;
        });
      }
    }

    // 作成/編集モーダル（ラベル類）
    if (t.modal && t.modal.form){
      const lblTitle = document.querySelector("label[for='mTitle']");
      const lblLimit = document.querySelector("label[for='mLimit']");
      const lblStart = document.querySelector("label[for='mStart']");
      const lblTarget= document.querySelector("label[for='mTarget']");
      if (lblTitle && t.modal.form.titleLabel) lblTitle.textContent = t.modal.form.titleLabel;
      if (lblLimit && t.modal.form.limitLabel) lblLimit.textContent = t.modal.form.limitLabel;
      if (lblStart && t.modal.form.startLabel) lblStart.textContent = t.modal.form.startLabel;
      if (lblTarget && t.modal.form.targetLabel) lblTarget.textContent = t.modal.form.targetLabel;
      const note = document.querySelector('.note');
      if (note && t.modal.form.targetNote) note.textContent = t.modal.form.targetNote;
      // Free/Paid/Price のラベル i18n は必要なら後で追加
    }

    // 作成/編集モーダル（ボタン類）
    if (t.modal){
      const deleteBtn   = document.getElementById('delete');
      const duplicateBtn= document.getElementById('duplicate');
      const close2      = document.getElementById('close2');
      const submit      = document.getElementById('submit');
      const modalTitle  = document.getElementById('modalTitle');

      if (deleteBtn && t.modal.deleteButton) deleteBtn.textContent = t.modal.deleteButton;
      if (duplicateBtn && t.modal.duplicateButton) duplicateBtn.textContent = t.modal.duplicateButton;
      if (close2 && t.modal.closeButton) close2.textContent = t.modal.closeButton;

      if (submit){
        if (window.mode === 'edit'){
          submit.textContent = t.modal.submitUpdate || submit.textContent;
        }else{
          submit.textContent = t.modal.submitCreate || submit.textContent;
        }
      }
      if (modalTitle){
        if (window.mode === 'edit'){
          modalTitle.textContent = t.modal.editTitle || modalTitle.textContent;
        }else{
          modalTitle.textContent = t.modal.createTitle || modalTitle.textContent;
        }
      }
    }

    // URL アラート
    if (t.alert){
      const alertTitle = document.getElementById('alertTitle');
      const alertBody  = document.getElementById('alertBody');
      const alertOk    = document.getElementById('alertOk');
      if (alertTitle && t.alert.title) alertTitle.textContent = t.alert.title;
      if (alertBody && t.alert.body)   alertBody.textContent  = t.alert.body;
      if (alertOk && t.alert.ok)       alertOk.textContent    = t.alert.ok;
    }

    // 言語トグルボタンとメニューの表示更新
    const langToggle = document.getElementById('langToggle');
    if (langToggle){
      langToggle.textContent = LANGUAGE_LABELS[current] || 'Language';
    }
    const menuButtons = document.querySelectorAll('.lang-switch__menu button[data-lang]');
    menuButtons.forEach(btn=>{
      const code = btn.getAttribute('data-lang');
      if (LANGUAGE_LABELS[code]) btn.textContent = LANGUAGE_LABELS[code];
      btn.classList.toggle('is-active', code === current);
    });
  }

  // ドロップダウンの開閉制御
  function setupLangDropdown(){
    const toggle = document.getElementById('langToggle');
    const menu   = document.getElementById('langMenu');
    if (!toggle || !menu) return;

    toggle.addEventListener('click', function(ev){
      ev.stopPropagation();
      menu.hidden = !menu.hidden;
    });

    menu.addEventListener('click', function(ev){
      ev.stopPropagation();
      const btn = ev.target.closest('button[data-lang]');
      if (!btn) return;
      const lang = btn.getAttribute('data-lang');
      window.switchLang(lang);
    });

    document.addEventListener('click', function(){
      if (!menu.hidden){
        menu.hidden = true;
      }
    });

    document.addEventListener('keydown', function(ev){
      if (ev.key === 'Escape' && !menu.hidden){
        menu.hidden = true;
      }
    });
  }

  // グローバル関数として公開（メニューから呼ばれる）
  window.switchLang = function(lang){
    const menu = document.getElementById('langMenu');
    if (menu) menu.hidden = true;
    loadLanguage(lang);
  };

  // 初期言語のロード後に startApp() を起動
  document.addEventListener('DOMContentLoaded', function(){
    setupLangDropdown();

    let stored = null;
    try{
      stored = localStorage.getItem('lang');
    }catch(e){}
    const initial = stored || 'en';
    updateHtmlLangAndDir(initial);
    loadLanguage(initial).finally(function(){
      if (!appStarted && typeof window.startApp === 'function'){
        appStarted = true;
        window.startApp();
      }
    });
  });
})();
