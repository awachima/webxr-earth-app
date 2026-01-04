// ===== ヘッダー高さに応じて --header-offset を更新 =====
function adjustHeaderOffset(){
  const header = document.querySelector('.site-header');
  if(!header) return;
  const h = header.getBoundingClientRect().height || 0;
  document.documentElement.style.setProperty('--header-offset', `${Math.ceil(h)}px`);
}
window.addEventListener('load', adjustHeaderOffset);
window.addEventListener('resize', adjustHeaderOffset);

// ===== Helpers =====
function qs(sel, root=document){ return root.querySelector(sel); }
function qsa(sel, root=document){ return Array.from(root.querySelectorAll(sel)); }

function safeText(s){ return (s==null) ? '' : String(s); }
function clamp(n, a, b){ return Math.max(a, Math.min(b, n)); }

// ===== モーダル共通：開閉 =====
function openModal(id){
  const modal = document.getElementById(id);
  if(!modal) return;
  modal.style.display = 'block';
  modal.setAttribute('aria-hidden', 'false');
  document.body.classList.add('modal-open');
}
function closeModal(){
  qsa('.modal').forEach(m=>{
    m.style.display = 'none';
    m.setAttribute('aria-hidden', 'true');
  });
  document.body.classList.remove('modal-open');
}

// ===== 待合室（Meetup Room）関連 =====
const API_BASE = "https://do-chat.awachima7.workers.dev";

async function apiGet(path){
  const res = await fetch(API_BASE + path, { method:'GET' });
  if(!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return await res.json();
}
async function apiPost(path, body){
  const res = await fetch(API_BASE + path, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body || {})
  });
  if(!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`POST ${path} failed: ${res.status} ${t}`);
  }
  return await res.json();
}

function formatCountdown(ms){
  const sign = ms < 0 ? "-" : "";
  ms = Math.abs(ms);
  const s = Math.floor(ms/1000);
  const hh = Math.floor(s/3600);
  const mm = Math.floor((s%3600)/60);
  const ss = Math.floor(s%60);
  const pad = (n)=> String(n).padStart(2,'0');
  return `${sign}${hh}:${pad(mm)}:${pad(ss)}`;
}

function createRoomCard(room){
  const card = document.createElement('div');
  card.className = 'room-card';

  const title = document.createElement('div');
  title.className = 'room-title';
  title.textContent = safeText(room.title || 'Untitled');

  const info = document.createElement('div');
  info.className = 'room-info';

  const type = document.createElement('div');
  type.className = 'room-type';
  type.textContent = safeText(room.eventType || '');

  const countdown = document.createElement('div');
  countdown.className = 'room-countdown';
  countdown.dataset.start = safeText(room.startTime || '');

  info.appendChild(type);
  info.appendChild(countdown);

  const actions = document.createElement('div');
  actions.className = 'room-actions';

  const enter = document.createElement('a');
  enter.className = 'btn';
  enter.setAttribute('data-enter', '');
  enter.href = safeText(room.url || '#');
  enter.target = '_blank';
  enter.rel = 'noopener';
  enter.textContent = '入室する';

  const edit = document.createElement('button');
  edit.className = 'btn btn-edit';
  edit.type = 'button';
  edit.textContent = '編集';
  edit.addEventListener('click', ()=>{
    openEditModal(room);
  });

  actions.appendChild(enter);
  actions.appendChild(edit);

  card.appendChild(title);
  card.appendChild(info);
  card.appendChild(actions);

  return card;
}

let roomTimer = null;

function startRoomCountdownTick(container){
  if(roomTimer) clearInterval(roomTimer);
  const tick = ()=>{
    const now = Date.now();
    qsa('.room-countdown', container).forEach(el=>{
      const startStr = el.dataset.start;
      if(!startStr) return;
      const start = Date.parse(startStr);
      if(isNaN(start)) return;
      const diff = start - now;
      el.textContent = `開始まで：${formatCountdown(diff)}`;
    });
  };
  tick();
  roomTimer = setInterval(tick, 1000);
}

async function refreshRooms(){
  const container = document.getElementById('roomsContainer');
  if(!container) return;
  container.innerHTML = '';
  try{
    const data = await apiGet('/rooms');
    const rooms = (data && Array.isArray(data.rooms)) ? data.rooms : [];
    rooms.forEach(r=>{
      container.appendChild(createRoomCard(r));
    });
    startRoomCountdownTick(container);
  }catch(e){
    console.error('[rooms] load error:', e);
    const err = document.createElement('div');
    err.className = 'room-error';
    err.textContent = '待合室の読み込みに失敗しました。';
    container.appendChild(err);
  }
}

// ===== モーダル：作成/編集 =====
function setEventTypeInModal(type, price){
  const paidWrap = document.getElementById('paidPriceWrap');
  const priceInput = document.getElementById('price');
  if(!paidWrap || !priceInput) return;

  if(type === 'paid'){
    paidWrap.style.display = 'block';
    priceInput.value = price || '';
  }else{
    paidWrap.style.display = 'none';
    priceInput.value = '';
  }
}

function openEditModal(room){
  openModal('editModal');
  const title = document.getElementById('title2');
  const url = document.getElementById('url2');
  const start = document.getElementById('start2');
  const type = document.getElementById('eventType2');
  const price = document.getElementById('price2');

  if(title) title.value = safeText(room.title);
  if(url) url.value = safeText(room.url);
  if(start) start.value = safeText(room.startTime);

  if(type){
    type.value = safeText(room.eventType || 'free');
    if(type.value === 'paid'){
      const wrap = document.getElementById('paidPriceWrap2');
      if(wrap) wrap.style.display = 'block';
      if(price) price.value = safeText(room.price || '');
    }else{
      const wrap = document.getElementById('paidPriceWrap2');
      if(wrap) wrap.style.display = 'none';
      if(price) price.value = '';
    }
  }

  const saveBtn = document.getElementById('save');
  const delBtn  = document.getElementById('delete');

  if(saveBtn){
    saveBtn.onclick = async ()=>{
      try{
        const body = {
          id: room.id,
          title: title ? title.value : '',
          url: url ? url.value : '',
          startTime: start ? start.value : '',
          eventType: type ? type.value : 'free',
          price: (type && type.value === 'paid' && price) ? price.value : ''
        };
        await apiPost('/rooms/update', body);
        closeModal();
        await refreshRooms();
      }catch(e){
        console.error('[rooms] update error:', e);
        alert('更新に失敗しました。Console をご確認ください。');
      }
    };
  }

  if(delBtn){
    delBtn.onclick = async ()=>{
      if(!confirm('この待合室を削除しますか？')) return;
      try{
        await apiPost('/rooms/delete', { id: room.id });
        closeModal();
        await refreshRooms();
      }catch(e){
        console.error('[rooms] delete error:', e);
        alert('削除に失敗しました。Console をご確認ください。');
      }
    };
  }
}

// ===== タグ絞り込みモーダル（iframe上 左上ボタン） =====
function setupTagFilterModal(){
  const btn = document.getElementById('filterBtn');
  const modal = document.getElementById('modal');
  const close = document.getElementById('close');
  const close2 = document.getElementById('close2');
  if(!btn || !modal) return;

  const open = ()=>{
    modal.style.display = 'block';
    modal.setAttribute('aria-hidden', 'false');
  };
  const closeM = ()=>{
    modal.style.display = 'none';
    modal.setAttribute('aria-hidden', 'true');
  };

  btn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    ev.stopPropagation();
    open();
  });
  if(close) close.addEventListener('click', closeM);
  if(close2) close2.addEventListener('click', closeM);

  // 外側クリックで閉じる
  document.addEventListener('click', (ev)=>{
    if(modal.style.display !== 'block') return;
    const panel = qs('.modal-content', modal);
    if(panel && !panel.contains(ev.target) && ev.target !== btn){
      closeM();
    }
  });

  // ESC で閉じる
  document.addEventListener('keydown', (ev)=>{
    if(ev.key === 'Escape'){
      closeM();
    }
  });

  // もし初期状態が表示されてしまう環境があれば、確実に閉じる
  closeM();
}

// ===== ツアー提案（Lucy）パネル：表示/非表示トグル =====
function setupRecommendPanelToggle(){
  const btn = document.getElementById('touristInfoBtn');
  const panel = document.getElementById('recommendSection');
  if (!btn || !panel) return;

  const setOpen = (open)=>{
    if (open){
      panel.classList.remove('is-collapsed');
      panel.classList.add('is-open');
      panel.setAttribute('aria-hidden', 'false');
      btn.setAttribute('aria-expanded', 'true');
    } else {
      panel.classList.add('is-collapsed');
      panel.classList.remove('is-open');
      panel.setAttribute('aria-hidden', 'true');
      btn.setAttribute('aria-expanded', 'false');
    }
  };

  // 初期状態：HTML側に is-collapsed が付いていれば尊重、無ければ閉じる
  const initiallyOpen = panel.classList.contains('is-open') && !panel.classList.contains('is-collapsed');
  setOpen(initiallyOpen);

  btn.addEventListener('click', ()=>{
    const open = panel.classList.contains('is-open') && !panel.classList.contains('is-collapsed');
    setOpen(!open);
  });

  // ESC で閉じる
  document.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Escape'){
      setOpen(false);
    }
  });
}

// ===== ツアー提案（Lucy）チャット：送信が効かない時のフェイルセーフ =====
// 目的：recommend.js が何らかの理由で実行されない／要素が差し替わる等でも、最低限送信が動くようにする
function setupLucyRecommendChatFallback(){
  const input = document.getElementById('recommendInput');
  const sendBtn = document.getElementById('recommendSend');
  const chatBox = document.getElementById('recommendChat');

  if (!input || !sendBtn || !chatBox) return;

  // 既に recommend.js 側でバインド済みなら何もしない
  if (sendBtn.dataset && sendBtn.dataset.lucyBound === '1') return;

  const ENDPOINT = 'https://lucy-recommend.awachima7.workers.dev/';
  const ASSISTANT = 'Lucy';
  let history = [];

  function append(role, text){
    const wrap = document.createElement('div');
    wrap.style.margin = '6px 0';

    const label = document.createElement('div');
    label.style.fontWeight = '700';
    label.style.fontSize = '0.85rem';
    label.style.opacity = '0.85';
    label.textContent = (role === 'user') ? 'You' : ASSISTANT;

    const body = document.createElement('div');
    body.style.whiteSpace = 'pre-wrap';
    body.style.fontSize = '0.92rem';
    body.textContent = text;

    wrap.appendChild(label);
    wrap.appendChild(body);
    chatBox.appendChild(wrap);
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function sendHighlights(highlightRows, exampleSpots){
    try{
      const iframe = document.getElementById('webxr-iframe');
      if (!iframe || !iframe.contentWindow) return;
      iframe.contentWindow.postMessage({
        type: 'dd-lucy-highlight',
        highlightRows: Array.isArray(highlightRows) ? highlightRows : [],
        exampleSpots: Array.isArray(exampleSpots) ? exampleSpots : []
      }, '*');
    }catch(e){}
  }

  async function handleSend(){
    const msg = (input.value || '').trim();
    if (!msg) return;

    input.value = '';
    append('user', msg);

    // 送信中は多重送信を防ぐ
    const prevDisabled = sendBtn.disabled;
    sendBtn.disabled = true;

    try{
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, history })
      });

      const data = await res.json().catch(()=>null);

      if (!res.ok || !data){
        append('assistant', '接続状況が少し不安定なようで、候補をうまく取得できませんでした。\nお手数ですが、時間をおいてもう一度お試しいただけますか？');
        return;
      }

      const reply = (data.reply && String(data.reply).trim()) ? String(data.reply).trim() : '(no reply)';
      append('assistant', reply);

      history.push({ role: 'user', text: msg });
      history.push({ role: 'assistant', text: reply });
      history = history.slice(-6);

      sendHighlights(data.highlightRows, data.exampleSpots);
    }catch(e){
      append('assistant', '送信に失敗したようです。Network / Console をご確認ください。');
      console.error('[Lucy fallback] send error:', e);
    }finally{
      sendBtn.disabled = prevDisabled;
    }
  }

  sendBtn.addEventListener('click', (ev)=>{
    ev.preventDefault();
    handleSend();
  });

  input.addEventListener('keydown', (ev)=>{
    if (ev.key === 'Enter'){
      ev.preventDefault();
      handleSend();
    }
  });

  // バインド済みマーク（devtools でも判別しやすい）
  if (sendBtn.dataset) sendBtn.dataset.lucyBound = '1';
  console.debug('[Lucy fallback] listeners attached');
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

  var onWheel = function(ev){
    // iframe上にカーソルがある間は、ページ全体スクロールを抑止
    ev.preventDefault();
  };

  var entered = false;
  iframe.addEventListener('mouseenter', function(){
    if(entered) return;
    entered = true;
    window.addEventListener('wheel', onWheel, { passive:false });
  });

  iframe.addEventListener('mouseleave', function(){
    entered = false;
    window.removeEventListener('wheel', onWheel, { passive:false });
  });
})();

// ===== 初期化（IIFE） =====
(function(){
  // 待合室一覧の取得
  refreshRooms().catch(()=>{});

  // 待合室作成モーダルのイベント初期化
  const createBtn = document.getElementById('create');
  const createBtn2 = document.getElementById('create2');
  const modal = document.getElementById('createModal');
  const modal2 = document.getElementById('editModal');

  if(createBtn){
    createBtn.addEventListener('click', ()=> openModal('createModal'));
  }
  if(createBtn2){
    createBtn2.addEventListener('click', ()=> openModal('createModal'));
  }

  const cancel = document.getElementById('cancel');
  if(cancel) cancel.onclick = closeModal;

  const cancel2 = document.getElementById('cancel2');
  if(cancel2) cancel2.onclick = closeModal;

  // イベント種別（無料/有料）
  const eventType = document.getElementById('eventType');
  if(eventType){
    eventType.addEventListener('change', (e)=>{
      const v = e.target.value;
      setEventTypeInModal(v, '');
    });
    // 起動時は free
    setEventTypeInModal('free', '');
  }

  // タイトル右の作成ボタン
  const oc = document.getElementById('openCreate');
  if (oc) oc.onclick = () => openModal('create');

  // 読み込み直後は確実に非表示（チラ見え対策）
  closeModal();

  // タグ絞り込みモーダル（iframe上 左上ボタン）
  setupTagFilterModal();

  // ツアー提案（Lucy）パネル：tourist-information ボタンで開閉
  setupRecommendPanelToggle();

  // ツアー提案（Lucy）チャット：送信が効かない時のフェイルセーフ
  setupLucyRecommendChatFallback();

  // ★ここが今回の本丸：存在しない要素で例外停止しないようにガード
  const closeBtn  = document.getElementById('close');
  if (closeBtn) closeBtn.onclick = closeModal;
  const closeBtn2 = document.getElementById('close2');
  if (closeBtn2) closeBtn2.onclick = closeModal;

  // 作成確定
  const submit = document.getElementById('submit');
  if(submit){
    submit.addEventListener('click', async ()=>{
      try{
        const title = (document.getElementById('title')||{}).value || '';
        const url = (document.getElementById('url')||{}).value || '';
        const start = (document.getElementById('start')||{}).value || '';
        const type = (document.getElementById('eventType')||{}).value || 'free';
        const price = (type === 'paid') ? ((document.getElementById('price')||{}).value || '') : '';

        const body = { title, url, startTime: start, eventType: type, price };
        await apiPost('/rooms/create', body);
        closeModal();
        await refreshRooms();
      }catch(e){
        console.error('[rooms] create error:', e);
        alert('作成に失敗しました。Console をご確認ください。');
      }
    });
  }

  // ===== 言語切り替え（右上） =====
  async function loadLanguage(lang){
    try{
      const res = await fetch(`./lang/${lang}.json`, { cache:'no-store' });
      if(!res.ok) throw new Error('lang load fail');
      const dict = await res.json();
      applyLanguage(dict, lang);
      try{ localStorage.setItem('lang', lang); }catch(e){}
    }catch(e){
      console.warn('lang load error', e);
    }
  }

  function applyLanguage(dict, lang){
    // data-i18n を持つ要素へ反映
    qsa('[data-i18n]').forEach(el=>{
      const k = el.getAttribute('data-i18n');
      if(!k) return;
      if(dict && dict[k]!=null){
        el.textContent = dict[k];
      }
    });
    document.documentElement.lang = lang || 'en';
  }

  function setupLangMenu(){
    const wrap = document.getElementById('langWrap');
    const btn = document.getElementById('langBtn');
    const menu = document.getElementById('langMenu');
    if(!wrap || !btn || !menu) return;

    const open = ()=>{
      menu.style.display = 'block';
      btn.setAttribute('aria-expanded', 'true');
    };
    const close = ()=>{
      menu.style.display = 'none';
      btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', (ev)=>{
      ev.preventDefault();
      ev.stopPropagation();
      const openNow = (menu.style.display === 'block');
      if (openNow) close(); else open();
    });

    document.addEventListener('click', ()=>{
      close();
    });

    menu.addEventListener('click', (ev)=>{
      ev.stopPropagation();
    });

    menu.querySelectorAll('button[data-lang]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const lang = btn.getAttribute('data-lang') || 'en';
        loadLanguage(lang);
        close();
      });
    });

    close();
  }

  // 初期化：メニューをセットし、保存言語を読み込み
  setupLangMenu();
  let initialLang = 'en';
  try{
    const stored = localStorage.getItem('lang');
    if (stored) initialLang = stored;
  }catch(e){}
  loadLanguage(initialLang);
})();
