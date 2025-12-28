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

  // ★ badge は任意（「数字を出さない」場合は存在しない）
  const badge = document.getElementById('tagFilterCount');

  const backdrop = document.getElementById('tagFilterBackdrop');
  const modal = backdrop ? backdrop.querySelector('.tag-filter-modal') : null;
  const closeBtn = document.getElementById('tagFilterClose');
  const applyBtn = document.getElementById('tagFilterApply');

  // ★ clearBtn も任意（UIによっては消している可能性がある）
  const clearBtn = document.getElementById('tagFilterClear');

  const colWrap = document.getElementById('tagFilterColumns');
  const iframe = document.getElementById('webxr-iframe');

  // ★ badge / clearBtn は必須にしない
  if (!btn || !backdrop || !modal || !closeBtn || !applyBtn || !colWrap || !iframe){
    return;
  }

  // ----------------------------
  //  Data structures
  // ----------------------------
  // node: { id, label, depth, parentId, children:Set<id> }
  const nodesById = new Map();
  const childrenByParent = new Map(); // parentId -> Set(childId)
  const label = new Map();            // id -> label
  const parent = new Map();           // id -> parentId
  const depthById = new Map();        // id -> depth (1..)
  const pathById = new Map();         // id -> ancestors array (ids)

  // root pseudo id
  const ROOT_ID = '__root__';

  // selection state
  let selected = new Set();  // Set<nodeId>
  let path = [];             // currently opened path (ids per depth)
  let activeDepth = 1;       // 1..3 (visible columns)
  const MAX_DEPTH = 3;

  // ----------------------------
  //  Helpers
  // ----------------------------
  function normalize(s){
    return (s || '').toString().trim();
  }
  function csvParseLine(line){
    // simple CSV parse (handles quoted)
    const out = [];
    let cur = '';
    let q = false;
    for (let i=0; i<line.length; i++){
      const ch = line[i];
      if (q){
        if (ch === '"'){
          if (line[i+1] === '"'){ cur += '"'; i++; }
          else q = false;
        }else{
          cur += ch;
        }
      }else{
        if (ch === '"'){ q = true; }
        else if (ch === ','){ out.push(cur); cur=''; }
        else { cur += ch; }
      }
    }
    out.push(cur);
    return out;
  }

  function ensureNode(id, labelText, depth, parentId){
    if (!nodesById.has(id)){
      nodesById.set(id, { id, label: labelText, depth, parentId, children: new Set() });
      label.set(id, labelText);
      parent.set(id, parentId);
      depthById.set(id, depth);
    }
    if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, new Set());
    childrenByParent.get(parentId).add(id);
  }

  function buildPaths(){
    nodesById.forEach((node)=>{
      const anc = [];
      let cur = node.id;
      while (cur && cur !== ROOT_ID){
        const p = parent.get(cur);
        if (!p || p === ROOT_ID) break;
        anc.push(p);
        cur = p;
      }
      anc.reverse();
      pathById.set(node.id, anc);
    });
  }

  function saveSelection(){
    try{
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
    }catch(e){}
  }

  function loadSelection(){
    try{
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)){
        selected = new Set(arr.map(String));
        hadSavedSelection = selected.size > 0;
      }
    }catch(e){}
  }

  // ★ badge が無い場合は何もしない
  function setBadge(){
    if (!badge) return;
    badge.textContent = `(${selected.size})`;
  }

  function getDescendants(id){
    const out = [];
    const st = [id];
    while (st.length){
      const cur = st.pop();
      const ch = childrenByParent.get(cur);
      if (!ch) continue;
      ch.forEach(cid=>{
        out.push(cid);
        st.push(cid);
      });
    }
    return out;
  }

  function setNodeAndDescendants(id, on){
    if (on){
      selected.add(id);
      getDescendants(id).forEach(d=>selected.add(d));
    }else{
      selected.delete(id);
      getDescendants(id).forEach(d=>selected.delete(d));
    }
  }

  function computeIndeterminateStates(){
    // returns { checked:Set, indeterminate:Set }
    const checked = new Set(selected);
    const ind = new Set();

    // post-order by depth (deep -> shallow)
    const nodes = Array.from(nodesById.values()).sort((a,b)=>b.depth - a.depth);
    nodes.forEach(node=>{
      const ch = childrenByParent.get(node.id);
      if (!ch || ch.size === 0) return;

      let allOn = true;
      let anyOn = false;
      ch.forEach(cid=>{
        if (checked.has(cid)) anyOn = true;
        else allOn = false;
        if (ind.has(cid)) anyOn = true;
      });

      if (allOn){
        checked.add(node.id);
        ind.delete(node.id);
      }else if (anyOn){
        checked.delete(node.id);
        ind.add(node.id);
      }else{
        checked.delete(node.id);
        ind.delete(node.id);
      }
    });
    return { checked, indeterminate: ind };
  }

  // ----------------------------
  //  Render columns
  // ----------------------------
  function clearColumns(){
    colWrap.innerHTML = '';
  }

  function createColumn(titleText){
    const col = document.createElement('div');
    col.className = 'tag-filter-col';
    const h = document.createElement('div');
    h.className = 'tag-filter-col-title';
    h.textContent = titleText;
    col.appendChild(h);
    return col;
  }

  function renderColumns(){
    clearColumns();

    const { checked, indeterminate } = computeIndeterminateStates();

    // column 1: root children (depth 1)
    // column 2: children of path[0]
    // column 3: children of path[1]
    const cols = [];
    const col1 = createColumn('カテゴリ');
    renderList(col1, ROOT_ID, 1, checked, indeterminate);
    cols.push(col1);

    const l1 = path[0] || null;
    const col2 = createColumn(l1 ? (label.get(l1) || 'LEVEL2') : ' ');
    renderList(col2, l1, 2, checked, indeterminate);
    cols.push(col2);

    const l2 = path[1] || null;
    const col3 = createColumn(l2 ? (label.get(l2) || 'LEVEL3') : ' ');
    renderList(col3, l2, 3, checked, indeterminate);
    cols.push(col3);

    cols.forEach(c=>colWrap.appendChild(c));

    // ★ clearBtn がある場合のみ表示制御
    if (clearBtn){
      if (selected.size > 0){
        clearBtn.style.display = '';
        clearBtn.removeAttribute('aria-hidden');
        clearBtn.removeAttribute('tabindex');
      }else{
        clearBtn.style.display = 'none';
        clearBtn.setAttribute('aria-hidden','true');
        clearBtn.setAttribute('tabindex','-1');
      }
    }
  }

  function renderList(colEl, parentId, depth, checked, indeterminate){
    if (!parentId){
      return;
    }
    const ch = childrenByParent.get(parentId);
    if (!ch || ch.size === 0){
      return;
    }

    const arr = Array.from(ch).map(id=>nodesById.get(id)).filter(Boolean);
    arr.sort((a,b)=> (a.label || '').localeCompare((b.label || ''), 'ja'));

    arr.forEach(node=>{
      const row = document.createElement('div');
      row.className = 'tag-item';
      if (path[depth-1] === node.id) row.classList.add('active');

      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = checked.has(node.id);
      cb.indeterminate = indeterminate.has(node.id);

      const lab = document.createElement('label');
      lab.textContent = node.label;

      const chev = document.createElement('div');
      chev.style.opacity = '0.5';
      chev.style.marginLeft = 'auto';
      const hasKids = (childrenByParent.get(node.id) && childrenByParent.get(node.id).size>0);
      chev.textContent = hasKids ? '›' : '';

      row.appendChild(cb);
      row.appendChild(lab);
      row.appendChild(chev);

      cb.addEventListener('click', (e)=>{
        e.stopPropagation();
        const on = cb.checked;
        setNodeAndDescendants(node.id, on);
        saveSelection();
        setBadge();
        renderColumns();
      });

      row.addEventListener('click', ()=>{
        const depthIdx = node.depth - 1;
        path = path.slice(0, depthIdx);
        path[depthIdx] = node.id;

        if (!hasKids){
          path = path.slice(0, depthIdx+1);
        }
        renderColumns();
      });

      colEl.appendChild(row);
    });
  }

  // ----------------------------
  //  Earth messaging
  // ----------------------------
  function postSelected(){
    const tags = Array.from(selected)
      .map(id => label.get(id) || id)
      .map(s => s.trim())
      .filter(Boolean);

    try{
      iframe.contentWindow.postMessage({ type:'dd-tags-apply', tags }, '*');
    }catch(e){
      console.warn(e);
    }
  }

  function tryAutoApply(){
    if (autoApplied) return;
    if (!earthReady) return;
    if (!treeReady) return;
    if (!hadSavedSelection) return;

    autoApplied = true;
    postSelected();
  }

  window.addEventListener('message', (ev)=>{
    const data = ev && ev.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'dd-earth-ready'){
      earthReady = true;
      tryAutoApply();
    }
  });

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal(){
    backdrop.setAttribute('aria-hidden','false');
    backdrop.classList.add('open');
    document.body.style.overflow = 'hidden';

    // position modal so its top-left matches the button position
    modal.style.visibility = 'hidden';
    modal.style.left = '0px';
    modal.style.top = '0px';

    requestAnimationFrame(()=>{
      try{
        const b = btn.getBoundingClientRect();
        const m = modal.getBoundingClientRect();

        let left = Math.round(b.left);
        let top  = Math.round(b.top);

        const margin = 8;
        if (left + m.width > window.innerWidth - margin) left = Math.max(margin, Math.round(window.innerWidth - margin - m.width));
        if (top + m.height > window.innerHeight - margin) top = Math.max(margin, Math.round(window.innerHeight - margin - m.height));

        modal.style.left = left + 'px';
        modal.style.top  = top  + 'px';
      }catch(e){
        // leave at (0,0)
      }finally{
        modal.style.visibility = 'visible';
      }
    });

    renderColumns();
  }

  function closeModal(){
    backdrop.setAttribute('aria-hidden','true');
    backdrop.classList.remove('open');
    document.body.style.overflow = '';
    modal.style.visibility = '';
  }

  // ----------------------------
  //  Events
  // ----------------------------
  btn.addEventListener('click', openModal);
  closeBtn.addEventListener('click', closeModal);

  backdrop.addEventListener('click', (e)=>{
    if (e.target === backdrop) closeModal();
  });

  applyBtn.addEventListener('click', ()=>{
    saveSelection();
    setBadge();
    postSelected();
    closeModal();
  });

  // ★ clearBtn がある場合のみイベントを付ける
  if (clearBtn){
    clearBtn.addEventListener('click', ()=>{
      selected = new Set();
      saveSelection();
      setBadge();
      renderColumns();
    });
  }

  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && backdrop.classList.contains('open')){
      closeModal();
    }
  });

  // ----------------------------
  //  Load tree (CSV)
  // ----------------------------
  async function fetchCsv(url){
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error('fetch failed: ' + res.status);
    return await res.text();
  }

  function buildTreeFromCsv(csvText){
    nodesById.clear();
    childrenByParent.clear();
    label.clear();
    parent.clear();
    depthById.clear();
    pathById.clear();

    nodesById.set(ROOT_ID, { id: ROOT_ID, label:'ROOT', depth:0, parentId:null, children:new Set() });
    label.set(ROOT_ID, 'ROOT');
    parent.set(ROOT_ID, null);
    depthById.set(ROOT_ID, 0);

    const lines = csvText.split(/\r?\n/).filter(l=>l.trim().length>0);
    if (lines.length <= 1) return;

    const header = csvParseLine(lines[0]).map(s=>normalize(s).toLowerCase());
    const idx1 = header.indexOf('level1');
    const idx2 = header.indexOf('level2');
    const idx3 = header.indexOf('level3');

    for (let i=1;i<lines.length;i++){
      const cols = csvParseLine(lines[i]);
      const l1 = normalize(cols[idx1]);
      const l2 = normalize(cols[idx2]);
      const l3 = normalize(cols[idx3]);

      if (!l1) continue;

      const id1 = 'L1:' + l1;
      ensureNode(id1, l1, 1, ROOT_ID);

      if (l2){
        const id2 = 'L2:' + l1 + '>' + l2;
        ensureNode(id2, l2, 2, id1);

        if (l3){
          const id3 = 'L3:' + l1 + '>' + l2 + '>' + l3;
          ensureNode(id3, l3, 3, id2);
        }
      }
    }

    childrenByParent.forEach((set, pid)=>{
      const pnode = nodesById.get(pid);
      if (pnode){
        pnode.children = set;
      }
    });

    buildPaths();
  }

  async function loadTree(){
    let csvText = null;

    try{
      csvText = await fetchCsv(TREE_URL_PRIMARY);
    }catch(e){
      try{
        csvText = await fetchCsv(TREE_URL_FALLBACK);
      }catch(e2){
        console.warn('tree load failed', e2);
        csvText = null;
      }
    }

    treeReady = true;

    if (!csvText){
      renderColumns();
      tryAutoApply();
      return;
    }

    buildTreeFromCsv(csvText);

    selected = new Set(Array.from(selected).filter(id=>nodesById.has(id)));

    const firstL1 = (childrenByParent.get(ROOT_ID) && childrenByParent.get(ROOT_ID).size>0)
      ? Array.from(childrenByParent.get(ROOT_ID))[0]
      : null;

    if (firstL1 && !path[0]) path[0] = firstL1;

    setBadge();
    renderColumns();
    tryAutoApply();
  }

  // ----------------------------
  //  Init
  // ----------------------------
  loadSelection();
  setBadge();
  loadTree();

})();
