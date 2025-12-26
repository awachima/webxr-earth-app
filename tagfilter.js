(function(){
  // ----------------------------
  //  Tag Filter (Tree / Columns)
  // ----------------------------
  const STORAGE_KEY = 'dd_selected_tags_v1';

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

  const columnsRoot = document.getElementById('tagFilterColumns');
  const iframe = document.getElementById('webxr-iframe');

  if (!btn || !badge || !backdrop || !applyBtn || !clearBtn || !columnsRoot || !iframe) {
    console.warn('[tag-filter] required elements not found');
    return;
  }

  let nodesById = new Map();
  let selected = new Set();
  let roots = [];
  let children = new Map(); // id -> child ids
  let label = new Map();    // id -> label
  let parent = new Map();   // id -> parent id

  // UI state: current drill path (array of ids)
  let path = [];

  function setBadgeCount(n){
    badge.textContent = `(${n})`;
  }

  function saveSelection(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
    }catch(_){}
  }

  function loadSelection(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)){
        selected = new Set(arr.filter(x => typeof x === 'string' && x.trim()));
      }
    }catch(_){}
  }

  function parseCSV(text){
    const lines = (text || '').replace(/\r/g,'').split('\n').filter(l => l.trim() !== '');
    const rows = [];

    for (const line of lines){
      const out = [];
      let cur = '';
      let inQ = false;

      for (let i=0;i<line.length;i++){
        const ch = line[i];
        if (ch === '"'){
          if (inQ && line[i+1] === '"'){ cur += '"'; i++; continue; }
          inQ = !inQ;
          continue;
        }
        if (ch === ',' && !inQ){
          out.push(cur);
          cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur);
      rows.push(out.map(s => (s || '').trim()));
    }
    return rows;
  }

  function makeNode(id, label, parentId){
    return { id, label, parentId, children: new Map() };
  }

  // ★ 重要：Google Sheets のCSVは「結合セル」があると空欄で出力されることがある
  // → それを「上の値を引き継ぐ（fill-down）」してからツリーを作る
  function buildTreeFromRows(rows){
    if (!rows || rows.length === 0) return makeNode('__root__','(root)', null);

    const header = rows[0].map(s=>s.trim());
    const levelIdx = [];
    for (let i=0;i<header.length;i++){
      const h = header[i];
      if (/^level/i.test(h)) levelIdx.push(i);
    }

    const startRow = levelIdx.length ? 1 : 0;
    const levels = levelIdx.length ? levelIdx : [0,1,2,3,4,5];

    const root = makeNode('__root__', '(root)', null);

    function getChild(p, lab){
      const key = lab;
      if (!p.children.has(key)){
        const id = p.id === '__root__' ? key : `${p.id} / ${key}`;
        const node = makeNode(id, key, p.id);
        p.children.set(key, node);
        nodesById.set(node.id, node);
      }
      return p.children.get(key);
    }

    // fill-down state（階層ごとの現在値）
    const curLevels = [];

    for (let r=startRow;r<rows.length;r++){
      const row = rows[r];

      // この行で「何か値がある」かをチェック（全空行スキップ）
      let hasAny = false;
      for (const idx of levels){
        if (idx < row.length && (row[idx] || '').trim() !== ''){
          hasAny = true;
          break;
        }
      }
      if (!hasAny) continue;

      // 1) fill-down 更新
      //  - 値が入っている階層があれば、その階層を更新し
      //  - それより下位階層はリセット（空扱い）にする
      //  - 値が空の階層は「前の値を維持」
      for (let li=0; li<levels.length; li++){
        const idx = levels[li];
        const v = (idx < row.length ? (row[idx] || '').trim() : '');

        if (v){
          curLevels[li] = v;
          // 下位階層をリセット
          for (let j=li+1; j<levels.length; j++){
            curLevels[j] = '';
          }
        } else {
          // 空欄は維持（Sheets結合セル対策）
          if (typeof curLevels[li] !== 'string') curLevels[li] = '';
        }
      }

      // 2) 現在の階層パスを作る（空になるまで）
      const pathLabels = [];
      for (let li=0; li<levels.length; li++){
        const v = (curLevels[li] || '').trim();
        if (!v) break;
        pathLabels.push(v);
      }
      if (pathLabels.length === 0) continue;

      // 3) ツリーに追加
      let p = root;
      for (const lab of pathLabels){
        p = getChild(p, lab);
      }
    }

    return root;
  }

  function indexTree(root){
    roots = [];
    children = new Map();
    label = new Map();
    parent = new Map();

    function ensureKids(id){
      if (!children.has(id)) children.set(id, []);
    }

    function walk(node, parentId){
      if (node.id !== '__root__'){
        label.set(node.id, node.label);
        parent.set(node.id, parentId);
        ensureKids(node.id);
      }

      const kids = Array.from(node.children.values());
      kids.sort((a,b)=> (a.label||'').localeCompare(b.label||'', 'ja'));

      for (const k of kids){
        if (node.id === '__root__'){
          roots.push(k.id);
        } else {
          ensureKids(node.id);
          children.get(node.id).push(k.id);
        }
        walk(k, node.id === '__root__' ? null : node.id);
      }
    }
    walk(root, null);
  }

  function collectDescTags(nodeId){
    const out = [];
    if (nodeId && nodeId !== '__root__') out.push(nodeId);
    const stack = [nodeId];
    while(stack.length){
      const cur = stack.pop();
      const kids = children.get(cur) || [];
      for (const k of kids){
        out.push(k);
        stack.push(k);
      }
    }
    return out;
  }

  function getState(nodeId){
    const ids = collectDescTags(nodeId);
    let hit = 0;
    for (const id of ids){
      if (selected.has(id)) hit++;
    }
    if (hit === 0) return 'unchecked';
    if (hit === ids.length) return 'checked';
    return 'indeterminate';
  }

  function setChecked(nodeId, on){
    const ids = collectDescTags(nodeId);
    if (on) ids.forEach(id => selected.add(id));
    else ids.forEach(id => selected.delete(id));
  }

  function nodeRow(nodeId){
    const kids = children.get(nodeId) || [];
    const state = getState(nodeId);

    const row = document.createElement('div');
    row.className = 'node';
    row.dataset.id = nodeId;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = (state === 'checked');
    cb.indeterminate = (state === 'indeterminate');

    const lbl = document.createElement('div');
    lbl.className = 'label';
    lbl.textContent = label.get(nodeId) || nodeId;

    const chev = document.createElement('div');
    chev.className = 'chev';
    chev.textContent = kids.length ? '›' : '';

    cb.addEventListener('click', (e)=>{
      e.stopPropagation();
      const wantOn = !(state === 'checked');
      setChecked(nodeId, wantOn);
      saveSelection();
      renderColumns();
    });

    row.addEventListener('click', ()=>{
      const newPath = [];
      let cur = nodeId;
      while(cur){
        newPath.push(cur);
        cur = parent.get(cur) || null;
      }
      path = newPath.reverse();
      renderColumns();
    });

    row.appendChild(cb);
    row.appendChild(lbl);
    row.appendChild(chev);
    return row;
  }

  function renderColumns(){
    columnsRoot.innerHTML = '';

    if (!roots || roots.length === 0){
      const msg = document.createElement('div');
      msg.style.padding = '14px';
      msg.style.fontSize = '13px';
      msg.style.opacity = '0.8';
      msg.textContent = 'tree の読み込みに失敗しました。Google Sheets の公開設定（CSV）または tree.csv の配置を確認してください。';
      columnsRoot.appendChild(msg);
      setBadgeCount(selected.size);
      return;
    }

    // 1列目（カテゴリ）
    const col0 = document.createElement('div');
    col0.className = 'column';
    const h0 = document.createElement('h3');
    h0.textContent = 'カテゴリ';
    col0.appendChild(h0);
    for (const id of roots){
      col0.appendChild(nodeRow(id));
    }
    columnsRoot.appendChild(col0);

    // 右側に「選択中ノードの子」を列として増やす
    for (let depth=0; depth<path.length; depth++){
      const id = path[depth];
      const kids = children.get(id) || [];
      if (!kids.length) break;

      const col = document.createElement('div');
      col.className = 'column';
      const h = document.createElement('h3');
      h.textContent = label.get(id) || id;
      col.appendChild(h);

      for (const cid of kids){
        col.appendChild(nodeRow(cid));
      }
      columnsRoot.appendChild(col);
    }

    setBadgeCount(selected.size);
  }

  function openModal(){
    backdrop.setAttribute('aria-hidden','false');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderColumns();
    setTimeout(()=>{ applyBtn.focus(); }, 30);
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

  btn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });

  applyBtn.addEventListener('click', ()=>{
    saveSelection();
    postSelected();
    closeModal();
  });

  clearBtn.addEventListener('click', ()=>{
    selected = new Set();
    saveSelection();
    renderColumns();
    postSelected();
  });

  async function init(){
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
    if (!csvText){
      csvText = 'level1,level2,level3\n';
    }

    nodesById.clear();
    const treeRoot = buildTreeFromRows(parseCSV(csvText));
    indexTree(treeRoot);

    // selection pruning
    const pruned = new Set();
    for (const id of selected){
      if (nodesById.has(id)) pruned.add(id);
    }
    selected = pruned;
    saveSelection();

    renderColumns();
    closeModal();
  }

  init();
})();
