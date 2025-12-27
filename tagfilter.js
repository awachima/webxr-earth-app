(function(){
  // ----------------------------
  //  Tag Filter (Tree / Columns)
  // ----------------------------
  const STORAGE_KEY = 'dd_selected_tags_v1';

  // 自動適用（リロード時に earth 側へ再送）
  let hadSavedSelection = false;
  let treeReady = false;
  let autoApplied = false;
  let earthReady = false;
  let autoApplyTimer = null;

  // ★ Google Sheets「ウェブに公開」(CSV) を読む
  // 重要: pubhtml ではなく output=csv を使う
  const TREE_URL_PRIMARY =
    'https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv';

  // フォールバック（同梱tree.csvがある場合）
  const TREE_URL_FALLBACK = './tree.csv';

  const btn = document.getElementById('tagFilterBtn');
  const badge = document.getElementById('tagFilterCount');

  const backdrop = document.getElementById('tagFilterBackdrop');
  const closeBtn = document.getElementById('tagFilterClose');
  const applyBtn = document.getElementById('tagFilterApply');
  const clearBtn = document.getElementById('tagFilterClear');

  const colWrap = document.getElementById('tagFilterColumns');
  const iframe = document.getElementById('webxr-iframe');

  if (!btn || !badge || !backdrop || !closeBtn || !applyBtn || !clearBtn || !colWrap || !iframe){
    console.warn('[tag-filter] required elements not found.');
    return;
  }

  // nodes
  const nodesById = new Map(); // id -> node
  const label = new Map();     // id -> label
  let root = null;

  // selection: Set(nodeId)
  let selected = new Set();
  // expanded path: [col0SelectedId, col1SelectedId, ...]
  let path = [];

  // ----------------------------
  //  Helpers
  // ----------------------------
  function setBadge(){
    badge.textContent = `(${selected.size})`;
  }

  function saveSelection(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
    }catch(_){}
  }

  function loadSelection(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) { hadSavedSelection = false; return; }
      hadSavedSelection = true;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)){
        selected = new Set(arr.filter(x => typeof x === 'string' && x.trim()));
      }
    }catch(_){}
  }

  function parseCSV(text){
    const lines = (text || '').replace(/\r\n/g,'\n').replace(/\r/g,'\n').split('\n');
    const rows = [];
    for (const line of lines){
      if (!line.trim()) continue;
      const cells = [];
      let cur = '';
      let inQ = false;
      for (let i=0;i<line.length;i++){
        const ch = line[i];
        if (inQ){
          if (ch === '"'){
            if (line[i+1] === '"'){ cur += '"'; i++; }
            else inQ = false;
          }else cur += ch;
        }else{
          if (ch === '"') inQ = true;
          else if (ch === ','){ cells.push(cur); cur=''; }
          else cur += ch;
        }
      }
      cells.push(cur);
      rows.push(cells.map(s => (s||'').trim()));
    }
    return rows;
  }

  function makeNode(id, lab, parentId){
    const n = {
      id,
      label: lab,
      parentId,
      children: new Map(), // label -> node
      depth: 0
    };
    label.set(id, lab);
    return n;
  }

  function buildTreeFromCSV(csvText){
    nodesById.clear();
    label.clear();
    root = null;

    const rows = parseCSV(csvText);
    if (!rows.length) throw new Error('CSV empty');

    // find header
    const header = rows[0].map(s => s.trim());
    const headerLower = header.map(s => s.toLowerCase());

    // Determine which columns to treat as levels.
    // We accept:
    //  - "level1, level2, level3, level4" etc.
    //  - Japanese: "1階層目", "2階層目" ...
    //  - Or if unknown: use first 4~6 cols (excluding empty header)
    const levelIdx = [];
    for (let i=0;i<headerLower.length;i++){
      const h = headerLower[i];
      if (/^level\s*\d+$/.test(h)) levelIdx.push(i);
      if (/^\d+\s*階層目$/.test(header[i])) levelIdx.push(i);
      if (h.includes('level1') || h.includes('level 1')) levelIdx.push(i);
    }

    // If we didn't find explicit columns, use first 6 columns as fallback
    const levels = levelIdx.length ? levelIdx : [0,1,2,3,4,5];

    const rootNode = makeNode('__root__', '(root)', null);
    nodesById.set(rootNode.id, rootNode);
    root = rootNode;

    function getChild(p, lab){
      const key = lab;
      if (!p.children.has(key)){
        const id = p.id === '__root__' ? key : `${p.id} / ${key}`;
        const node = makeNode(id, key, p.id);
        node.depth = (p.depth||0)+1;
        p.children.set(key, node);
        nodesById.set(node.id, node);
      }
      return p.children.get(key);
    }

    // fill-down state（階層ごとの現在値）
    const curLevels = [];

    // skip header row
    for (let r=1;r<rows.length;r++){
      const row = rows[r];
      // normalize levels with fill-down:
      // if a cell is empty, inherit from above
      for (let li=0; li<levels.length; li++){
        const ci = levels[li];
        const v = (row[ci] || '').trim();
        if (v) curLevels[li] = v;
        else row[ci] = curLevels[li] || '';
      }

      // Create path from non-empty levels
      const parts = [];
      for (let li=0; li<levels.length; li++){
        const ci = levels[li];
        const v = (row[ci] || '').trim();
        if (!v) break;
        parts.push(v);
      }
      if (!parts.length) continue;

      // add nodes
      let p = rootNode;
      for (const lab of parts){
        p = getChild(p, lab);
      }
    }
    return rootNode;
  }

  function isDescendant(nodeId, ancestorId){
    if (!nodeId || !ancestorId) return false;
    if (nodeId === ancestorId) return true;
    let cur = nodesById.get(nodeId);
    while(cur && cur.parentId){
      if (cur.parentId === ancestorId) return true;
      cur = nodesById.get(cur.parentId);
    }
    return false;
  }

  function collectDescendants(ancestorId){
    const out = [];
    const start = nodesById.get(ancestorId);
    if (!start) return out;
    const stack = [start];
    while(stack.length){
      const n = stack.pop();
      out.push(n.id);
      for (const ch of n.children.values()){
        stack.push(ch);
      }
    }
    return out;
  }

  function hasPartialSelection(ancestorId){
    const all = collectDescendants(ancestorId);
    if (!all.length) return false;
    let any = false;
    let allOn = true;
    for (const id of all){
      const on = selected.has(id);
      if (on) any = true;
      else allOn = false;
    }
    return any && !allOn;
  }

  function setNodeAndDescendants(ancestorId, on){
    const all = collectDescendants(ancestorId);
    for (const id of all){
      if (on) selected.add(id);
      else selected.delete(id);
    }
  }

  // ----------------------------
  //  UI Rendering (Columns)
  // ----------------------------
  function clearColumns(){
    colWrap.innerHTML = '';
  }

  function makeCol(titleText){
    const col = document.createElement('div');
    col.className = 'tag-filter-col';
    const h = document.createElement('div');
    h.className = 'tag-filter-col-title';
    h.textContent = titleText || '';
    col.appendChild(h);
    return col;
  }

  function makeItem(node, isActive){
    const row = document.createElement('div');
    row.className = 'tag-item' + (isActive ? ' active' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = selected.has(node.id);
    cb.indeterminate = hasPartialSelection(node.id);

    const lab = document.createElement('label');
    lab.textContent = node.label;

    const chev = document.createElement('span');
    chev.textContent = node.children.size ? '›' : '';
    chev.style.opacity = '0.55';
    chev.style.marginLeft = 'auto';

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    // checkbox click: toggle with descendants
    cb.addEventListener('click', (e)=>{
      e.stopPropagation();
      const on = cb.checked;
      setNodeAndDescendants(node.id, on);
      saveSelection();
      setBadge();
      renderColumns(); // reflect indeterminate changes
    });

    // row click: open next column (path)
    row.addEventListener('click', ()=>{
      // update path at current depth
      const depth = node.depth - 1; // root children depth 1 => depth idx 0
      path = path.slice(0, depth);
      path[depth] = node.id;
      renderColumns();
    });

    return row;
  }

  function getChildrenSorted(node){
    const arr = Array.from(node.children.values());
    arr.sort((a,b)=>a.label.localeCompare(b.label,'ja'));
    return arr;
  }

  function renderColumns(){
    if (!root) return;

    clearColumns();
    setBadge();

    // column 0: root children
    let curNode = root;
    let colIdx = 0;

    while(curNode){
      const title = (colIdx===0) ? 'カテゴリ' : (label.get(path[colIdx-1]) || '');
      const col = makeCol(title);

      const kids = getChildrenSorted(curNode);
      for (const k of kids){
        const active = path[colIdx] === k.id;
        col.appendChild(makeItem(k, active));
      }

      colWrap.appendChild(col);

      // next
      const nextId = path[colIdx];
      const nextNode = nextId ? nodesById.get(nextId) : null;
      if (nextNode && nextNode.children.size){
        curNode = nextNode;
        colIdx++;
        continue;
      }
      break;
    }
  }

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal(){
    backdrop.setAttribute('aria-hidden','false');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    // selection already rendered
    renderColumns();
  }

  function closeModal(){
    backdrop.setAttribute('aria-hidden','true');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
  }

  function postSelected(){
    // earth側は「タグ名」を期待しているので label を送る
    const tags = Array.from(selected)
      .map(id => label.get(id) || id)
      .map(s => s.trim())
      .filter(Boolean);

    try{
      iframe.contentWindow.postMessage({ type:'dd-tags-apply', tags }, '*');
    }catch(e){
      console.warn('[tag-filter] postMessage failed', e);
    }
  }

  function scheduleAutoApply(){
    if (!hadSavedSelection) return;
    if (autoApplied) return;
    if (!treeReady) return;

    // earth がリロード直後で listener 未準備でも拾えるように数回リトライ
    let tries = 0;
    const maxTries = 8;

    const tick = ()=>{
      if (autoApplied) return;
      if (!treeReady) return;

      tries += 1;
      try{
        postSelected();
        // postSelected が投げなければ「送信自体」は成功。earth 側が拾えない可能性に備え、数回は送る
      }catch(_){}

      if (tries >= maxTries){
        autoApplied = true;
        return;
      }
      autoApplyTimer = setTimeout(tick, 250);
    };

    if (autoApplyTimer) clearTimeout(autoApplyTimer);
    autoApplyTimer = setTimeout(tick, 50);
  }

  // earth 側が準備できた合図を送ってくる場合（推奨）
  window.addEventListener('message', (ev)=>{
    const d = ev && ev.data;
    const t = (d && (d.type || d.kind)) ? String(d.type || d.kind) : '';
    if (t === 'dd-earth-ready' || t === 'DD_EARTH_READY' || t === 'EARTH_READY'){
      earthReady = true;
      scheduleAutoApply();
    }
  });

  btn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });

  // earth iframe がリロードされたら、選択を再送できるようにする
  iframe.addEventListener('load', ()=>{
    autoApplied = false;
    earthReady = false;
    scheduleAutoApply();
  });

  applyBtn.addEventListener('click', ()=>{
    saveSelection();
    postSelected();
    closeModal();
  });

  clearBtn.addEventListener('click', ()=>{
    selected.clear();
    path = [];
    saveSelection();
    setBadge();
    renderColumns();
  });

  // ----------------------------
  //  Init
  // ----------------------------
  async function init(){
    // load selection from localStorage
    loadSelection();

    // load tree csv (Google Sheets published CSV -> local fallback)
    let csvText = '';
    const urls = [TREE_URL_PRIMARY, TREE_URL_FALLBACK];
    for (const url of urls){
      try{
        const res = await fetch(url, { cache:'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const t = await res.text();
        const head = t.slice(0, 400).toLowerCase();
        if (head.includes('<!doctype') || head.includes('<html') || head.includes('<head') || head.includes('<body')) {
          throw new Error('Got HTML instead of CSV');
        }
        csvText = t;
        console.log('[tag-filter] tree loaded from:', url);
        break;
      }catch(e){
        console.warn('[tag-filter] tree fetch failed:', url, e);
      }
    }
    if (!csvText) throw new Error('Failed to load tree CSV.');

    // build tree
    buildTreeFromCSV(csvText);

    // selection pruning
    const pruned = new Set();
    for (const id of selected){
      if (nodesById.has(id)) pruned.add(id);
    }
    selected = pruned;
    saveSelection();

    treeReady = true;
    renderColumns();
    closeModal();

    // リロードで index 側に選択が残っている場合は、earth 側へ自動で再送
    scheduleAutoApply();
  }

  init();
})();
