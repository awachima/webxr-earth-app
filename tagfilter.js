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

  // apply のスパムを避けるため軽くデバウンス
  let postTimer = null;
  function schedulePostSelected(delayMs = 120) {
    if (applyBtn) return; // applyBtn がある構成なら「適用」押下まで送らない
    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      postSelected();
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

  // ----------------------------
  //  Tree build / selection helpers
  // ----------------------------
  function addNode(nodeId, nodeLabel, depth, parentId) {
    if (!nodesById.has(nodeId)) {
      nodesById.set(nodeId, {
        id: nodeId,
        label: nodeLabel,
        depth,
        parentId,
        children: new Set(),
      });
    }
    label.set(nodeId, nodeLabel);
    parent.set(nodeId, parentId);
    depthById.set(nodeId, depth);

    const kids = ensureSet(childrenByParent, parentId);
    kids.add(nodeId);

    const pNode = nodesById.get(parentId);
    if (pNode) pNode.children.add(nodeId);

    // build path
    const ancestors = [];
    let cur = nodeId;
    while (cur && cur !== ROOT_ID) {
      const p = parent.get(cur);
      if (!p || p === ROOT_ID) break;
      ancestors.unshift(p);
      cur = p;
    }
    pathById.set(nodeId, ancestors);
  }

  function getChildren(parentId) {
    const s = childrenByParent.get(parentId || ROOT_ID);
    return s ? Array.from(s) : [];
  }

  function nodeHasChildren(nodeId) {
    const s = childrenByParent.get(nodeId);
    return s && s.size > 0;
  }

  function setNodeAndDescendants(nodeId, on) {
    // set node
    if (on) selected.add(nodeId);
    else selected.delete(nodeId);

    // set descendants
    const kids = childrenByParent.get(nodeId);
    if (!kids) return;
    kids.forEach((k) => setNodeAndDescendants(k, on));
  }

  function computeIndeterminateStates() {
    // For each node, compute if it should be indeterminate based on descendants selection.
    const checked = new Set();
    const indeterminate = new Set();

    function walk(nodeId) {
      const kids = childrenByParent.get(nodeId);
      if (!kids || kids.size === 0) {
        const isChecked = selected.has(nodeId);
        if (isChecked) checked.add(nodeId);
        return { any: isChecked, all: isChecked };
      }

      let any = false;
      let all = true;
      kids.forEach((k) => {
        const r = walk(k);
        any = any || r.any;
        all = all && r.all;
      });

      const selfChecked = selected.has(nodeId);
      if (selfChecked) {
        any = true;
      } else {
        all = false; // if self isn't checked, cannot be "all" in this simple model
      }

      if (selfChecked) checked.add(nodeId);
      if (any && !all) indeterminate.add(nodeId);
      return { any, all };
    }

    // walk from ROOT's children
    getChildren(ROOT_ID).forEach((id) => walk(id));
    return { checked, indeterminate };
  }

  // ----------------------------
  //  UI build
  // ----------------------------
  function clearColumns() {
    while (colWrap.firstChild) colWrap.removeChild(colWrap.firstChild);
  }

  function createColumn(title) {
    const col = document.createElement("div");
    col.className = "column";
    const h = document.createElement("h3");
    h.textContent = title || "";
    col.appendChild(h);
    return col;
  }

  function renderList(colEl, parentId, depth, checked, indeterminate) {
    if (!parentId) return;

    const kids = getChildren(parentId)
      .map((id) => nodesById.get(id))
      .filter(Boolean);

    // stable sort by label
    kids.sort((a, b) => (a.label || "").localeCompare(b.label || "", "ja"));

    kids.forEach((node) => {
      const row = document.createElement("div");
      row.className = "node";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(node.id);
      cb.indeterminate = indeterminate.has(node.id);

      const lab = document.createElement("div");
      lab.className = "label";
      lab.textContent = node.label || "";

      const hasKids = nodeHasChildren(node.id);
      const chev = document.createElement("div");
      chev.className = "chev";
      chev.textContent = hasKids ? "›" : "";

      row.appendChild(cb);
      row.appendChild(lab);
      row.appendChild(chev);

      // checkbox click: toggle with descendants
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = cb.checked;
        setNodeAndDescendants(node.id, on);
        saveSelection();
        setBadge();
        renderColumns();

        // ★ applyBtn が無い構成なら「自動適用」
        schedulePostSelected();
      });

      // row click: open next column (path)
      row.addEventListener("click", () => {
        const depthIdx = node.depth - 1;
        path = path.slice(0, depthIdx);
        path[depthIdx] = node.id;

        if (!hasKids) {
          path = path.slice(0, depthIdx + 1);
        }
        renderColumns();
      });

      colEl.appendChild(row);
    });
  }

  function renderColumns() {
    clearColumns();

    if (!treeReady) {
      const msg = document.createElement("div");
      msg.style.padding = "10px";
      msg.style.opacity = "0.8";
      msg.textContent = "読み込み中…";
      colWrap.appendChild(msg);
      return;
    }

    const { checked, indeterminate } = computeIndeterminateStates();

    const cols = [];

    const col1 = createColumn("カテゴリ");
    renderList(col1, ROOT_ID, 1, checked, indeterminate);
    cols.push(col1);

    const l1 = path[0] || null;
    const col2 = createColumn(l1 ? label.get(l1) || " " : " ");
    renderList(col2, l1, 2, checked, indeterminate);
    cols.push(col2);

    const l2 = path[1] || null;
    const showL2 = l2 && nodeHasChildren(l2); // ★ 2階層目が終端(子なし)なら3列目のタイトルに出さない
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
    // earth側は「タグ名」を期待しているので label を送る
    const tags = Array.from(selected)
      .map((id) => label.get(id) || id)
      .map((s) => String(s).trim())
      .filter(Boolean);

    try {
      iframe.contentWindow.postMessage({ type: "dd-tags-apply", tags }, "*");
    } catch (e) {
      console.warn(e);
    }
  }

  function tryAutoApply() {
    if (autoApplied) return;
    if (!earthReady) return;
    if (!treeReady) return;
    if (!hadSavedSelection) return;

    autoApplied = true;
    postSelected();
  }

  window.addEventListener("message", (ev) => {
    const data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "dd-earth-ready") {
      earthReady = true;
      tryAutoApply();
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

    // 中央に固定（CSSが position:fixed 前提）
    // ただし、スマホはヘッダー下に寄せたいので、CSS側で調整する
    try {
      modal.style.left = "50%";
      modal.style.top = "50%";
      modal.style.transform = "translate(-50%, -50%)";
    } catch (e) {}

    renderColumns();
  }

  function closeModal() {
    backdrop.style.display = "none";
    backdrop.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");
    backdrop.classList.remove("open");
    document.body.style.overflow = "";
  }

  // backdrop click to close
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  closeBtn.addEventListener("click", () => closeModal());

  // ESC to close
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      // style.display で開いている場合も考慮
      const open = backdrop.classList.contains("open") || backdrop.style.display === "flex";
      if (open) closeModal();
    }
  });

  btn.addEventListener("click", () => openModal());

  // ----------------------------
  //  Apply / Clear
  // ----------------------------
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      saveSelection();
      setBadge();
      postSelected();
      closeModal();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      selected = new Set();
      saveSelection();
      setBadge();
      renderColumns();

      // ★ applyBtn が無い構成なら「自動適用」
      schedulePostSelected();
    });
  }

  // ----------------------------
  //  Fetch tree.csv (Google Sheets)
  // ----------------------------
  async function fetchTreeCsv() {
    // まず primary を試し、ダメなら fallback
    const urls = [TREE_URL_PRIMARY, TREE_URL_FALLBACK];
    for (const url of urls) {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) continue;
        const csv = await res.text();
        if (!csv || !csv.trim()) continue;
        return csv;
      } catch (e) {}
    }
    return null;
  }

  function buildTreeFromCsv(csvText) {
    nodesById.clear();
    childrenByParent.clear();
    label.clear();
    parent.clear();
    depthById.clear();
    pathById.clear();

    // add ROOT
    nodesById.set(ROOT_ID, {
      id: ROOT_ID,
      label: "",
      depth: 0,
      parentId: null,
      children: new Set(),
    });
    childrenByParent.set(ROOT_ID, new Set());
    label.set(ROOT_ID, "");
    parent.set(ROOT_ID, null);
    depthById.set(ROOT_ID, 0);
    pathById.set(ROOT_ID, []);

    const lines = (csvText || "").split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length === 0) return;

    // header? (assume first line is header if it contains 'L1' or 'level')
    const first = csvParseLine(lines[0]).map((c) => normalize(c));
    const looksHeader = first.some((c) => /^(l1|level1|lvl1|category)$/i.test(c));
    const startIdx = looksHeader ? 1 : 0;

    for (let i = startIdx; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]).map((c) => normalize(c));
      if (cols.length === 0) continue;

      // 想定: 3列（L1, L2, L3）だが、余分があっても先頭3つだけ使う
      const l1 = cols[0] || "";
      const l2 = cols[1] || "";
      const l3 = cols[2] || "";

      const p1 = normalize(l1);
      const p2 = normalize(l2);
      const p3 = normalize(l3);

      // skip empty row
      if (!p1 && !p2 && !p3) continue;

      // build ids with hierarchy
      // id = depth + "||" + path
      let id1 = null;
      let id2 = null;
      let id3 = null;

      if (p1) {
        id1 = `1||${safeIdFromLabel(p1)}`;
        addNode(id1, p1, 1, ROOT_ID);
      }

      if (p2) {
        const parentId = id1 || ROOT_ID;
        id2 = `2||${safeIdFromLabel(p1)}||${safeIdFromLabel(p2)}`;
        addNode(id2, p2, 2, parentId);
      }

      if (p3) {
        const parentId = id2 || id1 || ROOT_ID;
        id3 = `3||${safeIdFromLabel(p1)}||${safeIdFromLabel(p2)}||${safeIdFromLabel(p3)}`;
        addNode(id3, p3, 3, parentId);
      }
    }
  }

  async function init() {
    loadSelection();
    setBadge();

    const csv = await fetchTreeCsv();
    if (!csv) {
      // fail silently (keep UI)
      treeReady = true;
      renderColumns();
      return;
    }

    buildTreeFromCsv(csv);
    treeReady = true;
    renderColumns();

    // 既に earth が ready なら auto apply
    tryAutoApply();
  }

  // Earth の ready を待たず、UI を先に作る
  init();
})();
