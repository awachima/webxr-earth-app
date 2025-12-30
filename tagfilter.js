(function () {
  // ----------------------------
  //  Tag Filter (Tree / Columns)
  // ----------------------------
  const STORAGE_KEY = "dd_selected_tags_v1";

  // ★ Google Sheets「ウェブに公開」(CSV) を読む
  // 重要: pubhtml ではなく output=csv を使う
  const TREE_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";

  // フォールバック（同梱tree.csvがある場合）
  const TREE_URL_FALLBACK = "./tree.csv";

  const btn = document.getElementById("tagFilterBtn");
  const badge = document.getElementById("tagFilterCount");

  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = backdrop ? backdrop.querySelector(".tag-filter-modal") : null;
  const closeBtn = document.getElementById("tagFilterClose");

  // ★ index.html に無い可能性があるので「任意」にする
  const applyBtn = document.getElementById("tagFilterApply");
  const clearBtn = document.getElementById("tagFilterClear");

  const colWrap = document.getElementById("tagFilterColumns");
  const iframe = document.getElementById("webxr-iframe");

  // ★ 必須要素だけチェック（apply/clear は無くても動かす）
  if (!btn || !badge || !backdrop || !modal || !closeBtn || !colWrap || !iframe) {
    return;
  }

  // ----------------------------
  //  Data structures
  // ----------------------------
  // node: { id, label, depth, parentId, children:Set<id> }
  const nodesById = new Map();
  const childrenByParent = new Map(); // parentId -> Set(childId)
  const label = new Map(); // id -> label
  const parent = new Map(); // id -> parentId
  const depthById = new Map(); // id -> depth (1..)
  const pathById = new Map(); // id -> ancestors array (ids)

  // root pseudo id
  const ROOT_ID = "__root__";

  // selection state
  let selected = new Set(); // Set<nodeId>
  let path = []; // currently opened path (ids per depth)
  const MAX_DEPTH = 3;

  // 自動適用（リロード時に earth 側へ再送）
  let hadSavedSelection = false;
  let treeReady = false;
  let earthReady = false;
  let autoApplied = false;

  // ★ earth 側がまだ message listener を用意する前に postMessage すると取りこぼすことがあります。
  //   （結果として「初回はマーカーが出ない → リロードで出る」になり得る）
  //   earth.html は受信後に { type:'FILTER_TAGS_APPLIED' } を返しているので、
  //   それを ACK として扱い、受信できるまで少しだけ再送します。
  let awaitingAppliedAck = false;
  let lastPostedSig = "";
  let retryCount = 0;
  let retryTimer2 = null;

  function clearRetry() {
    if (retryTimer2) {
      clearTimeout(retryTimer2);
      retryTimer2 = null;
    }
    retryCount = 0;
    awaitingAppliedAck = false;
  }

  function makeSig(tags) {
    try { return (tags || []).join("\u0001"); } catch (e) { return ""; }
  }

  function getSelectedTags() {
    return Array.from(selected)
      .map((id) => label.get(id) || id)
      .map((s) => String(s).trim())
      .filter(Boolean);
  }

  function postSelectedReliable() {
    const tags = getSelectedTags();
    lastPostedSig = makeSig(tags);
    awaitingAppliedAck = true;

    // まずは即送信
    try {
      iframe.contentWindow.postMessage({ type: "dd-tags-apply", tags }, "*");
    } catch (e) {
      console.warn(e);
    }

    // 再送（最大5回・軽いバックオフ）
    if (retryTimer2) clearTimeout(retryTimer2);
    retryCount = 0;

    const retryOnce = () => {
      if (!awaitingAppliedAck) return;

      retryCount++;
      if (retryCount > 5) {
        // 無限ループにしない
        awaitingAppliedAck = false;
        return;
      }

      try {
        iframe.contentWindow.postMessage({ type: "dd-tags-apply", tags }, "*");
      } catch (e) {}

      const nextDelay = [200, 400, 700, 1100, 1600][retryCount - 1] || 1600;
      retryTimer2 = setTimeout(retryOnce, nextDelay);
    };

    retryTimer2 = setTimeout(retryOnce, 200);
  }


  // iframe の load が tagfilter.js 読み込みより先に発火していると、
  // earth.html 側の dd-earth-ready が受け取れず、自動再適用が走らないことがある。
  // そのため「iframeが読み込まれている」こと自体でも earthReady を立てる。
  function markEarthReadyFromIframe() {
    if (earthReady) return;
    earthReady = true;
    tryAutoApply();
  }

  // 通常: iframe load で確実に検知
  iframe.addEventListener('load', () => {
    markEarthReadyFromIframe();
  });

  // 既に読み込み済み（load が先に終わっている）ケースも拾う
  setTimeout(() => {
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === 'complete') {
        markEarthReadyFromIframe();
      }
    } catch (e) {}
  }, 0);

  // apply のスパムを避けるため軽くデバウンス
  let postTimer = null;
  function schedulePostSelected(delayMs = 120) {
    if (applyBtn) return; // applyBtn がある構成なら「適用」押下まで送らない
    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      postSelectedReliable();
    }, delayMs);
  }

  // ----------------------------
  //  Helpers
  // ----------------------------
  function normalize(s) {
    return (s || "").toString().trim();
  }

  function safeIdFromLabel(s) {
    // stable-ish id: depth/label path
    return String(s || "")
      .trim()
      .replace(/\s+/g, " ")
      .replace(/[|]/g, "/");
  }

  function csvParseLine(line) {
    // minimal CSV parser (handles quotes)
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") {
          out.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    out.push(cur);
    return out;
  }

  function ensureSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  function setBadge() {
    // (0) も含めて常に表示（既存UI仕様に合わせる）
    try {
      badge.textContent = `(${selected.size})`;
      badge.style.display = "inline";
    } catch (e) {}
  }

  function saveSelection() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
    } catch (e) {}
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        selected = new Set(arr.map((x) => String(x)));
        hadSavedSelection = selected.size > 0;
      }
    } catch (e) {}
  }

  function nodeHasChildren(id) {
    const set = childrenByParent.get(id);
    return set && set.size > 0;
  }

  function buildPaths() {
    // build ancestor path array for each node
    nodesById.forEach((node, id) => {
      const ancestors = [];
      let cur = id;
      while (cur && cur !== ROOT_ID) {
        const p = parent.get(cur);
        if (!p) break;
        if (p === ROOT_ID) break;
        ancestors.unshift(p);
        cur = p;
      }
      pathById.set(id, ancestors);
    });
  }

  function setPathTo(id) {
    const ancestors = pathById.get(id) || [];
    // path is opened nodes per depth (1..MAX_DEPTH-1)
    path = ancestors.slice(0, MAX_DEPTH - 1);
    // also include this id if it's not leaf and within depth-1?
    const d = depthById.get(id) || 1;
    if (d <= MAX_DEPTH - 1 && nodeHasChildren(id)) {
      path[d - 1] = id;
    }
  }

  // When selecting parent, we may want to select/deselect all descendants.
  function collectDescendants(id) {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      out.push(cur);
      const kids = childrenByParent.get(cur);
      if (kids) {
        kids.forEach((k) => stack.push(k));
      }
    }
    return out;
  }

  function updateSelectionForNode(id, checked) {
    // select/deselect node + all descendants
    const ids = collectDescendants(id);
    if (checked) {
      ids.forEach((x) => selected.add(x));
    } else {
      ids.forEach((x) => selected.delete(x));
    }
  }

  function computeCheckedState(id) {
    // returns { checked:boolean, indeterminate:boolean }
    const kids = childrenByParent.get(id);
    if (!kids || kids.size === 0) {
      const c = selected.has(id);
      return { checked: c, indeterminate: false };
    }
    // for parent: checked if all descendants selected, indeterminate if some selected
    const all = collectDescendants(id);
    let selCount = 0;
    for (let i = 0; i < all.length; i++) {
      if (selected.has(all[i])) selCount++;
    }
    if (selCount === 0) return { checked: false, indeterminate: false };
    if (selCount === all.length) return { checked: true, indeterminate: false };
    return { checked: false, indeterminate: true };
  }

  // ----------------------------
  //  Render (3 columns)
  // ----------------------------
  function createColumn(title) {
    const col = document.createElement("div");
    col.className = "tag-filter-col";

    const h = document.createElement("div");
    h.className = "tag-filter-col-title";
    h.textContent = title || " ";
    col.appendChild(h);

    const list = document.createElement("div");
    list.className = "tag-filter-list";
    col.appendChild(list);

    col._list = list;
    return col;
  }

  function renderList(col, parentId, depth, checkedMap, indMap) {
    const list = col._list;
    list.innerHTML = "";

    const kids = childrenByParent.get(parentId || ROOT_ID);
    if (!kids || kids.size === 0) {
      const empty = document.createElement("div");
      empty.style.opacity = "0.55";
      empty.style.fontSize = "12px";
      empty.style.padding = "8px";
      empty.textContent = " ";
      list.appendChild(empty);
      return;
    }

    const arr = Array.from(kids);
    // sort by label
    arr.sort((a, b) => {
      const la = (label.get(a) || a).toString();
      const lb = (label.get(b) || b).toString();
      return la.localeCompare(lb, "ja");
    });

    arr.forEach((id) => {
      const item = document.createElement("div");
      item.className = "tag-item";

      const { checked, indeterminate } = computeCheckedState(id);
      checkedMap.set(id, checked);
      indMap.set(id, indeterminate);

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!checked;
      cb.indeterminate = !!indeterminate;

      // clicking checkbox toggles selection
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        updateSelectionForNode(id, cb.checked);
        setBadge();
        saveSelection();
        renderColumns();
        schedulePostSelected();
      });

      const lab = document.createElement("label");
      lab.textContent = label.get(id) || id;

      // item click toggles checkbox
      item.addEventListener("click", () => {
        const next = !cb.checked || cb.indeterminate;
        cb.checked = next;
        cb.indeterminate = false;
        updateSelectionForNode(id, next);
        setBadge();
        saveSelection();
        // open path if has children
        if (nodeHasChildren(id) && depth < MAX_DEPTH) {
          setPathTo(id);
        } else if (depth <= MAX_DEPTH - 1) {
          // if it's leaf at this depth, adjust path so next column title doesn't show leaf label
          // handled in renderColumns()
        }
        renderColumns();
        schedulePostSelected();
      });

      // mark active (opened in path)
      if (path[depth - 1] === id) {
        item.classList.add("active");
      }

      item.appendChild(cb);
      item.appendChild(lab);

      if (nodeHasChildren(id) && depth < MAX_DEPTH) {
        const chev = document.createElement("span");
        chev.className = "chev";
        chev.textContent = "›";
        item.appendChild(chev);
      }

      list.appendChild(item);
    });
  }

  function renderColumns() {
    colWrap.innerHTML = "";

    const checked = new Map();
    const indeterminate = new Map();

    // column1: root children
    const col1 = createColumn(" ");
    renderList(col1, null, 1, checked, indeterminate);

    const cols = [col1];

    const l1 = path[0] || null;
    const col2 = createColumn(l1 ? label.get(l1) || " " : " ");
    renderList(col2, l1, 2, checked, indeterminate);
    cols.push(col2);

    const l2 = path[1] || null;
    const showL2 = l2 && nodeHasChildren(l2); // ★ 2カラム目が終端(子なし)なら3カラム目のタイトルに出さない
    const col3 = createColumn(showL2 ? label.get(l2) || " " : " ");
    renderList(col3, showL2 ? l2 : null, 3, checked, indeterminate);
    cols.push(col3);

    cols.forEach((c) => colWrap.appendChild(c));

    // ★ クリアボタンは常時表示（選択が無い時だけ無効化）
    if (clearBtn) {
      clearBtn.style.display = "";
      clearBtn.removeAttribute("aria-hidden");
      clearBtn.removeAttribute("tabindex");

      const hasSelection = selected.size > 0;
      clearBtn.disabled = !hasSelection;
      clearBtn.style.opacity = hasSelection ? "1" : "0.55";
      clearBtn.style.pointerEvents = hasSelection ? "auto" : "none";
    }
  }

  // ----------------------------
  //  Earth messaging
  // ----------------------------
  function postSelected() {
    postSelectedReliable();
  }

  function tryAutoApply() {
    if (autoApplied) return;
    if (!earthReady) return;
    if (!treeReady) return;
    if (!hadSavedSelection) return;

    autoApplied = true;
    postSelectedReliable();
  }

  window.addEventListener("message", (ev) => {
    const data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "dd-earth-ready") {
      earthReady = true;
      tryAutoApply();
    }
    if (data.type === "FILTER_TAGS_APPLIED") {
      // earth 側でフィルタが反映された合図
      try {
        const sel =
          data.payload && Array.isArray(data.payload.selectedTags)
            ? data.payload.selectedTags
            : null;

        if (!sel) {
          clearRetry();
        } else {
          const sig = makeSig(
            sel.map((s) => String(s).trim()).filter(Boolean)
          );
          if (!lastPostedSig || sig === lastPostedSig) {
            clearRetry();
          }
        }
      } catch (e) {
        clearRetry();
      }
    }
  });

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal() {
    // main.js が style.display で開閉している構成でも確実に開く
    backdrop.style.display = "flex";
    backdrop.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");

    // tagfilter.js 側の open 判定（ESC など）にも使う
    backdrop.classList.add("open");

    document.body.style.overflow = "hidden";

    // position modal so its top-left matches the button position
    modal.style.visibility = "hidden";
    modal.style.left = "0px";
    modal.style.top = "0px";

    requestAnimationFrame(() => {
      try {
        const b = btn.getBoundingClientRect();
        const m = modal.getBoundingClientRect();

        let left = Math.round(b.left);
        let top = Math.round(b.top);

        const margin = 8;
        if (left + m.width > window.innerWidth - margin) {
          left = Math.max(margin, Math.round(window.innerWidth - margin - m.width));
        }
        if (top + m.height > window.innerHeight - margin) {
          top = Math.max(margin, Math.round(window.innerHeight - margin - m.height));
        }

        modal.style.left = left + "px";
        modal.style.top = top + "px";
      } catch (e) {
        // fallback
      } finally {
        modal.style.visibility = "visible";
      }
    });

    renderColumns();
  }

  function closeModal() {
    backdrop.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");

    // class も display も両方閉じる（どちらの方式でも確実に閉じる）
    backdrop.classList.remove("open");
    backdrop.style.display = "none";

    document.body.style.overflow = "";

    modal.style.visibility = "";
  }

  // ----------------------------
  //  Events
  // ----------------------------
  btn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  // click backdrop closes only when clicking outside modal
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  // ★ apply/clear がある構成だけイベントを生やす
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      saveSelection();
      setBadge();
      postSelectedReliable();
      closeModal();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      selected = new Set();
      saveSelection();
      setBadge();
      renderColumns();
      schedulePostSelected();
    });
  }

  // esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      closeModal();
    }
  });

  // ----------------------------
  //  Load CSV tree
  // ----------------------------
  async function fetchTreeCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed to fetch tree CSV");
    const text = await res.text();
    return text;
  }

  function ingestRows(rows) {
    // rows: array of arrays with 3 columns (L1,L2,L3) / may contain empties
    // build nodes using stable ids per path
    function ensureNode(id, lab, d, parentId) {
      if (!nodesById.has(id)) {
        nodesById.set(id, { id, label: lab, depth: d, parentId, children: new Set() });
        label.set(id, lab);
        depthById.set(id, d);
        parent.set(id, parentId);
        ensureSet(childrenByParent, parentId || ROOT_ID).add(id);
      }
      return nodesById.get(id);
    }

    // root
    if (!childrenByParent.has(ROOT_ID)) childrenByParent.set(ROOT_ID, new Set());

    rows.forEach((cols) => {
      const l1 = normalize(cols[0]);
      const l2 = normalize(cols[1]);
      const l3 = normalize(cols[2]);

      let id1 = null;
      let id2 = null;

      if (l1) {
        id1 = "1/" + safeIdFromLabel(l1);
        ensureNode(id1, l1, 1, ROOT_ID);
      }
      if (l2) {
        id2 = "2/" + safeIdFromLabel((l1 ? l1 + "/" : "") + l2);
        ensureNode(id2, l2, 2, id1 || ROOT_ID);
      }
      if (l3) {
        const id3 = "3/" + safeIdFromLabel((l1 ? l1 + "/" : "") + (l2 ? l2 + "/" : "") + l3);
        ensureNode(id3, l3, 3, id2 || id1 || ROOT_ID);
      }
    });

    // fill children sets
    nodesById.forEach((node) => {
      const kids = childrenByParent.get(node.id);
      if (kids) node.children = kids;
    });

    buildPaths();

    // If we have saved selection, open path to first selected node
    if (selected.size > 0) {
      const first = selected.values().next().value;
      if (first) setPathTo(first);
    }
  }

  async function initTree() {
    try {
      let csvText = null;
      try {
        csvText = await fetchTreeCsv(TREE_URL_PRIMARY);
      } catch (e) {
        // fallback
        csvText = await fetchTreeCsv(TREE_URL_FALLBACK);
      }

      // parse CSV
      const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== "");
      const rows = [];
      for (let i = 0; i < lines.length; i++) {
        const cols = csvParseLine(lines[i]).map((x) => (x || "").trim());

        // allow header
        if (i === 0) {
          const a = normalize(cols[0]);
          const b = normalize(cols[1]);
          const c = normalize(cols[2]);
          // if header looks like "L1,L2,L3" etc, skip it
          const head =
            /l1|level1|カテゴリ|category/i.test(a) ||
            /l2|level2|カテゴリ|category/i.test(b) ||
            /l3|level3|カテゴリ|category/i.test(c);
          if (head) continue;
        }

        // accept only first 3 columns
        rows.push([cols[0] || "", cols[1] || "", cols[2] || ""]);
      }

      ingestRows(rows);
      treeReady = true;

      setBadge();
      renderColumns();
      tryAutoApply();
    } catch (e) {
      console.warn("tag tree load failed", e);
      // still render empty columns to keep UI stable
      treeReady = true;
      setBadge();
      renderColumns();
      tryAutoApply();
    }
  }

  // ----------------------------
  //  Bootstrap
  // ----------------------------
  loadSelection();
  setBadge();
  initTree();
})();
