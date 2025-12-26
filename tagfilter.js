(function(){
    // ----------------------------
    //  Tag Filter (Tree / Columns)
    // ----------------------------
    const STORAGE_KEY = 'dd_selected_tags_v1';
    const TREE_URL_FALLBACK = './tree.csv';
    // Provided sheet (edit) cannot be fetched as CSV reliably without publishing;
    // keep as an optional hint for future.
    const TREE_SHEET_HINT = 'https://docs.google.com/spreadsheets/d/1Dnq6yPHPIlExsY9Qz-B6FrTuVM4L-ByG6xDcZk_5RlQ/edit?usp=sharing';

    const btn = document.getElementById('tagFilterBtn');
    const badge = document.getElementById('tagFilterCount');
    const backdrop = document.getElementById('tagFilterBackdrop');
    const closeBtn = document.getElementById('tagFilterClose');
    const applyBtn = document.getElementById('tagFilterApply');
    const clearBtn = document.getElementById('tagFilterClear');
    const colsRoot = document.getElementById('tagFilterColumns');
    const iframe = document.getElementById('webxr-iframe');

    if (!btn || !backdrop || !applyBtn || !colsRoot || !iframe) return;

    let tree = null;         // { label, children: Map }
    let nodesById = new Map(); // id -> node
    let selected = new Set();  // selected node ids (not expanded)
    let activePath = [];       // array of node ids representing the current "focused" path

    function openModal(){
      backdrop.setAttribute('aria-hidden','false');
      backdrop.classList.add('open');
      document.body.style.overflow = 'hidden';
      renderColumns();
      // focus for accessibility
      setTimeout(()=>{ applyBtn && applyBtn.focus(); }, 30);
    }

    function closeModal(){
      backdrop.setAttribute('aria-hidden','true');
      backdrop.classList.remove('open');
      document.body.style.overflow = '';
    }

    // backdrop open/close behavior (match existing modals)
    btn.addEventListener('click', openModal);
    closeBtn && closeBtn.addEventListener('click', closeModal);
    backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closeModal(); });
    window.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && backdrop.classList.contains('open')) closeModal(); });

    function setBadgeCount(n){
      badge.textContent = `(${n})`;
    }

    // ---- CSV parsing ----
    function parseCSV(text){
      const lines = text.replace(/\r/g,'').split('\n').filter(l => l.trim().length);
      if (!lines.length) return [];
      const rows = [];
      for (const line of lines){
        // simple CSV parser with quotes
        let parts = [];
        let cur = '';
        let inQ = false;
        for (let i=0;i<line.length;i++){
          const ch = line[i];
          if (ch === '"' ){ inQ = !inQ; continue; }
          if (ch === ',' && !inQ){
            parts.push(cur.trim());
            cur='';
          }else{
            cur += ch;
          }
        }
        parts.push(cur.trim());
        rows.push(parts.map(v=>{
          if (v.startsWith('"')) v=v.slice(1);
          if (v.endsWith('"')) v=v.slice(0,-1);
          return v.trim();
        }));
      }
      return rows;
    }

    function buildTreeFromRows(rows){
      // detect header with level columns
      const header = rows[0].map(s=>s.trim());
      const levelIdx = [];
      for (let i=0;i<header.length;i++){
        const h = header[i];
        if (/^level/i.test(h)) levelIdx.push(i);
      }
      const startRow = levelIdx.length ? 1 : 0;
      const levels = levelIdx.length ? levelIdx : [0,1,2,3,4,5]; // fallback
      const root = makeNode('__root__', '(root)', null);

      function getChild(parent, label){
        const key = label;
        if (!parent.children.has(key)){
          const id = parent.id === '__root__' ? key : `${parent.id} / ${key}`;
          const node = makeNode(id, key, parent.id);
          parent.children.set(key, node);
          nodesById.set(node.id, node);
        }
        return parent.children.get(key);
      }

      for (let r=startRow;r<rows.length;r++){
        const row = rows[r];
        let parent = root;
        let any = false;
        for (const idx of levels){
          if (idx >= row.length) continue;
          const v = (row[idx] || '').trim();
          if (!v) continue;
          any = true;
          parent = getChild(parent, v);
        }
        if (!any) continue;
      }
      return root;
    }

    function makeNode(id, label, parentId){
      return { id, label, parentId, children: new Map() };
    }

    function loadSelection(){
      try{
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)){
          selected = new Set(arr.filter(x=>typeof x==='string'));
        }
      }catch(_){}
    }
    function saveSelection(){
      try{
        localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
      }catch(_){}
    }

    function setIndeterminateForCheckbox(input, nodeId){
      // parent is indeterminate when some (but not all) descendants are checked
      const node = nodesById.get(nodeId);
      if (!node) return;

      const descendants = collectDescendants(nodeId, true); // include self
      const total = descendants.length;
      let checked = 0;
      for (const id of descendants){
        if (selected.has(id)) checked++;
      }
      input.indeterminate = (checked > 0 && checked < total);
      input.checked = (checked === total);
    }

    function collectDescendants(nodeId, includeSelf){
      const node = nodesById.get(nodeId);
      if (!node) return [];
      const out = [];
      (function walk(n){
        out.push(n.id);
        for (const ch of n.children.values()) walk(ch);
      })(node);
      return includeSelf ? out : out.slice(1);
    }

    function toggleNode(nodeId, checked){
      const ids = collectDescendants(nodeId, true); // include self
      if (checked){
        ids.forEach(id=>selected.add(id));
      }else{
        ids.forEach(id=>selected.delete(id));
      }
      saveSelection();
      // re-render to update indeterminate states
      renderColumns();
    }

    function setActivePath(path){
      activePath = path.slice();
      renderColumns();
    }

    function getNodeByPath(path){
      let cur = tree;
      for (const id of path){
        const n = nodesById.get(id);
        if (!n) break;
        cur = n;
      }
      return cur;
    }

    function renderColumns(){
      if (!tree) return;

      colsRoot.innerHTML = '';

      // Build columns along activePath:
      // col0: root children, col1: children of activePath[0], etc.
      const cols = [];
      cols.push({ title: 'カテゴリ', node: tree, depth: 0 });

      for (let i=0;i<activePath.length;i++){
        const n = nodesById.get(activePath[i]);
        if (!n) break;
        if (n.children.size){
          cols.push({ title: n.label, node: n, depth: i+1 });
        }
      }

      // If activePath is empty but there is only one top-level node, auto focus it for nicer UX
      if (activePath.length === 0 && tree.children.size === 1){
        const only = Array.from(tree.children.values())[0];
        activePath = [only.id];
        if (only.children.size){
          cols.push({ title: only.label, node: only, depth: 1 });
        }
      }

      for (let c=0;c<cols.length;c++){
        const col = cols[c];
        const el = document.createElement('div');
        el.className = 'tag-filter-col';

        const title = document.createElement('div');
        title.className = 'tag-filter-col-title';
        title.textContent = col.title;
        el.appendChild(title);

        const children = Array.from(col.node.children.values());
        // sort by label (Japanese locale friendly)
        children.sort((a,b)=>a.label.localeCompare(b.label,'ja'));

        for (const child of children){
          const item = document.createElement('div');
          item.className = 'tag-item';
          if (activePath[c] === child.id) item.classList.add('active');

          const cb = document.createElement('input');
          cb.type = 'checkbox';
          cb.dataset.nodeId = child.id;

          // set checked/indeterminate based on subtree selection
          // We'll compute by checking all descendants coverage.
          setIndeterminateForCheckbox(cb, child.id);

          cb.addEventListener('click', (ev)=>{
            ev.stopPropagation();
            toggleNode(child.id, cb.checked);
          });

          const label = document.createElement('label');
          label.textContent = child.label;

          item.appendChild(cb);
          item.appendChild(label);

          // clicking row focuses this node (to show next column to the right)
          item.addEventListener('click', ()=>{
            const nextPath = activePath.slice(0, c);
            nextPath[c] = child.id;
            setActivePath(nextPath);
          });

          el.appendChild(item);
        }

        colsRoot.appendChild(el);
      }

      // badge is number of selected "leaf tags to send" is unknown here,
      // keep badge as selected node count as UI feedback.
      setBadgeCount(selected.size);
    }

    function expandSelectedToLabels(){
      // Expand selected node ids into tag labels to send to earth:
      // - Include each selected node's label
      // - Also include descendants' labels when a parent is selected (already ensured by selection propagation)
      const out = [];
      const seen = new Set();

      for (const id of selected){
        const n = nodesById.get(id);
        if (!n) continue;
        const label = (n.label || '').trim();
        if (!label) continue;
        if (seen.has(label)) continue;
        seen.add(label);
        out.push(label);
      }
      return out;
    }

    // Apply: send tags to earth iframe
    applyBtn.addEventListener('click', ()=>{
      const tags = expandSelectedToLabels();
      try{
        iframe.contentWindow.postMessage({ type:'dd-tags-apply', tags }, '*');
      }catch(e){
        console.warn('[tag-filter] postMessage failed:', e);
      }
      closeModal();
    });

    clearBtn.addEventListener('click', ()=>{
      selected.clear();
      saveSelection();
      renderColumns();
    });

    // Receive counts back from earth (optional)
    window.addEventListener('message', (event)=>{
      const data = event && event.data ? event.data : null;
      if (!data) return;
      if (data.type === 'FILTER_TAGS_APPLIED' && data.payload && Array.isArray(data.payload.selectedTags)){
        // earth echoed what it applied (labels). Not used now.
      }
      if (data.type === 'DD_FILTER_STATS' && data.payload){
        // expected: { visibleCount, selectedTagsCount }
        const n = Number(data.payload.selectedTagsCount);
        if (!Number.isNaN(n)) setBadgeCount(n);
      }
    });

    async function init(){
      loadSelection();

      // load tree csv
      let csvText = '';
      try{
        const res = await fetch(TREE_URL_FALLBACK, { cache:'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        csvText = await res.text();
      }catch(e){
        console.warn('[tag-filter] tree.csv fetch failed. Hint:', TREE_SHEET_HINT, e);
        csvText = 'level1,level2,level3\n'; // empty
      }

      nodesById.clear();
      tree = buildTreeFromRows(parseCSV(csvText));

      // If saved ids include nodes no longer existing, prune
      const pruned = new Set();
      for (const id of selected){
        if (nodesById.has(id)) pruned.add(id);
      }
      selected = pruned;
      saveSelection();

      // Render once (modal closed, but badge should update)
      renderColumns();
      closeModal();
    }

    init();
  })();
