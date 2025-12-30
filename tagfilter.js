(function () {
  // =========================================================
  //  Tag Filter Modal (tree.csv) + Miss Notice (location.csv G/H)
  //  - "絞り込み" と "見逃し注意" は排他（どちらか一方だけ適用）
  //  - 選択数バッジ表示は不要（CSSで非表示）
  // =========================================================

  const STORAGE_KEY_TREE = "dd_filter_tree_selected_v1";
  const STORAGE_KEY_MISS = "dd_filter_miss_selected_v1";
  const STORAGE_KEY_APPLIED_MODE = "dd_filter_applied_mode_v1"; // 'tree' | 'miss' | 'none'

  const MODE_TREE = "tree";
  const MODE_MISS = "miss";

  // 公開CSV（必要ならあなたのURLに差し替え）
  const TREE_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";
  const TREE_URL_FALLBACK = "./tree.csv";

  const LOCATION_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=717261533&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

  // ---- DOM ----
  const btn = document.getElementById("tagFilterBtn");
  const badge = document.getElementById("tagFilterCount");

  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = backdrop ? backdrop.querySelector(".tag-filter-modal") : null;

  const closeBtn = document.getElementById("tagFilterClose");
  const applyBtn = document.getElementById("tagFilterApply");
  const clearBtn = document.getElementById("tagFilterClear");

  const tabTreeBtn = document.getElementById("ddFilterTabTree");
  const tabMissBtn = document.getElementById("ddFilterTabMiss");
  const paneTree = document.getElementById("ddPaneTree");
  const paneMiss = document.getElementById("ddPaneMiss");

  const colWrapTree = document.getElementById("tagFilterColumns");
  const colWrapMiss = document.getElementById("missFilterColumns");

  const iframe = document.getElementById("webxr-iframe");

  // 必須
  if (!btn || !backdrop || !modal || !closeBtn || !applyBtn || !clearBtn || !colWrapTree || !iframe) {
    return;
  }

  // 任意（index.html 側が未反映の時でも落とさない）
  const hasTabs = !!(tabTreeBtn && tabMissBtn && paneTree && paneMiss && colWrapMiss);

  // =========================================================
  //  Utility
  // =========================================================
  function normalize(s) {
    return (s || "").toString().trim();
  }

  function uniqKeepOrder(arr) {
    const out = [];
    const seen = new Set();
    for (const v0 of arr) {
      const v = normalize(v0);
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  // CSV 1行パース（引用符対応）
  function csvParseLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inQ) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQ = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQ = true;
        } else if (ch === ",") {
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

  async function fetchCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    return await res.text();
  }

  function setBadge() {
    // バッジは使わない（CSSで非表示）。ただし既存互換で呼び出しだけ残す。
    try {
      if (!badge) return;
      badge.textContent = "";
    } catch (e) {}
  }

  // =========================================================
  //  Modal open/close (既存UI互換：位置合わせ)
  // =========================================================
  function openModal() {
    backdrop.style.display = "flex";
    backdrop.setAttribute("aria-hidden", "false");
    backdrop.classList.add("open");
    btn.setAttribute("aria-expanded", "true");

    document.body.style.overflow = "hidden";

    // ボタン位置に合わせる（既存要件）
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
        // no-op
      } finally {
        modal.style.visibility = "visible";
      }
    });

    // デフォルトは A（絞り込み）
    if (hasTabs) setActiveMode(MODE_TREE);
    renderAll();
  }

  function closeModal() {
    backdrop.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");

    backdrop.classList.remove("open");
    backdrop.style.display = "none";

    document.body.style.overflow = "";
  }

  btn.addEventListener("click", openModal);
  closeBtn.addEventListener("click", closeModal);

  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      closeModal();
    }
  });

  // =========================================================
  //  Mode (排他)
  // =========================================================
  let activeMode = MODE_TREE;

  function setActiveMode(mode) {
    activeMode = mode === MODE_MISS ? MODE_MISS : MODE_TREE;

    if (hasTabs) {
      backdrop.dataset.activeMode = activeMode;

      tabTreeBtn.classList.toggle("is-active", activeMode === MODE_TREE);
      tabTreeBtn.setAttribute("aria-selected", activeMode === MODE_TREE ? "true" : "false");

      tabMissBtn.classList.toggle("is-active", activeMode === MODE_MISS);
      tabMissBtn.setAttribute("aria-selected", activeMode === MODE_MISS ? "true" : "false");

      paneTree.classList.toggle("is-inactive", activeMode !== MODE_TREE);
      paneMiss.classList.toggle("is-inactive", activeMode !== MODE_MISS);
    }
  }

  if (hasTabs) {
    tabTreeBtn.addEventListener("click", () => setActiveMode(MODE_TREE));
    tabMissBtn.addEventListener("click", () => setActiveMode(MODE_MISS));
  }

  // =========================================================
  //  Tree (tree.csv) : 3 columns / 3 levels
  // =========================================================
  const ROOT_ID = "__root__";

  const label = new Map(); // id -> label
  const parent = new Map(); // id -> parentId
  const children = new Map(); // parentId -> Set(childId)

  function safeIdFromPath(parts) {
    return parts.map((p) => normalize(p)).filter(Boolean).join(" › ");
  }

  function ensureSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  function addNode(pathParts) {
    const id = safeIdFromPath(pathParts);
    if (!id) return null;

    if (!label.has(id)) {
      label.set(id, normalize(pathParts[pathParts.length - 1]));
      const p = pathParts.length === 1 ? ROOT_ID : safeIdFromPath(pathParts.slice(0, -1));
      parent.set(id, p);
      ensureSet(children, p).add(id);
    }
    return id;
  }

  function getChildren(pid) {
    const set = children.get(pid);
    return set ? Array.from(set) : [];
  }

  function setNodeAndDescendants(id, on) {
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;
      if (on) selectedTree.add(cur);
      else selectedTree.delete(cur);
      const kids = getChildren(cur);
      for (const k of kids) stack.push(k);
    }
  }

  function computeIndeterminateStates() {
    const indeterminate = new Set();

    function walk(nodeId) {
      const kids = getChildren(nodeId);
      if (!kids.length) return selectedTree.has(nodeId) ? 1 : 0;

      let on = 0;
      let off = 0;

      for (const k of kids) {
        const r = walk(k);
        if (r === 1) on++;
        else if (r === 0) off++;
        else {
          indeterminate.add(nodeId);
          return -1;
        }
      }

      if (on === kids.length) return 1;
      if (off === kids.length) return 0;

      indeterminate.add(nodeId);
      return -1;
    }

    walk(ROOT_ID);
    return indeterminate;
  }

  let treeReady = false;
  let selectedTree = new Set(); // node ids
  let path = []; // selected per depth (0..2)

  function saveTreeSelection() {
    try {
      localStorage.setItem(STORAGE_KEY_TREE, JSON.stringify(Array.from(selectedTree)));
    } catch (e) {}
  }

  function loadTreeSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TREE);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) selectedTree = new Set(arr.map((x) => String(x)).filter(Boolean));
    } catch (e) {}
  }

  function clearTreeSelection() {
    selectedTree = new Set();
    path = [];
    saveTreeSelection();
  }

  function createColumn(title) {
    const col = document.createElement("div");
    col.className = "tag-filter-col";

    const h = document.createElement("div");
    h.className = "tag-filter-col-title";
    h.textContent = title;

    const list = document.createElement("div");
    list.className = "tag-filter-list";

    col.appendChild(h);
    col.appendChild(list);
    return { col, list };
  }

  function renderTreeList(listEl, ids, depth, indeterminate) {
    listEl.innerHTML = "";

    for (const id of ids) {
      const item = document.createElement("div");
      item.className = "tag-item";
      item.dataset.id = id;

      const lbl = document.createElement("label");
      lbl.textContent = label.get(id) || "";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedTree.has(id);
      cb.indeterminate = indeterminate.has(id);

      cb.addEventListener("change", () => {
        setNodeAndDescendants(id, cb.checked);
        saveTreeSelection();
        setBadge();
        renderTreeColumns();
      });

      item.addEventListener("click", (e) => {
        if (e.target === cb) return;
        path = path.slice(0, depth - 1);
        path[depth - 1] = id;
        renderTreeColumns();
      });

      item.appendChild(lbl);
      item.appendChild(cb);
      listEl.appendChild(item);
    }
  }

  function renderTreeColumns() {
    colWrapTree.innerHTML = "";

    if (!treeReady) {
      const msg = document.createElement("div");
      msg.textContent = "カテゴリを読み込み中です…";
      msg.style.padding = "10px";
      msg.style.opacity = "0.8";
      colWrapTree.appendChild(msg);
      return;
    }

    const indeterminate = computeIndeterminateStates();

    const c1 = createColumn("カテゴリ");
    renderTreeList(c1.list, getChildren(ROOT_ID), 1, indeterminate);

    const c2 = createColumn("サブカテゴリ");
    if (path[0]) renderTreeList(c2.list, getChildren(path[0]), 2, indeterminate);

    const c3 = createColumn("詳細");
    if (path[1]) renderTreeList(c3.list, getChildren(path[1]), 3, indeterminate);

    colWrapTree.appendChild(c1.col);
    colWrapTree.appendChild(c2.col);
    colWrapTree.appendChild(c3.col);
  }

  function buildTreeFromCsv(csvText) {
    label.clear();
    parent.clear();
    children.clear();
    label.set(ROOT_ID, "");
    parent.set(ROOT_ID, null);

    const lines = String(csvText || "").replace(/\r/g, "").split("\n").filter((l) => l !== "");
    if (!lines.length) return;

    // ヘッダー判定（1行目に level1/level2/level3 が含まれる場合はスキップ）
    let startIdx = 0;
    const first = csvParseLine(lines[0]).map((s) => normalize(s).toLowerCase());
    if (first.some((x) => x === "level1" || x === "level2" || x === "level3")) startIdx = 1;

    for (let i = startIdx; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]).map((c) => normalize(c));
      const a = cols[0] || "";
      const b = cols[1] || "";
      const c = cols[2] || "";
      if (!a) continue;

      const parts = [a];
      addNode(parts);
      if (b) {
        parts.push(b);
        addNode(parts);
      }
      if (c) {
        parts.push(c);
        addNode(parts);
      }
    }

    treeReady = true;
  }

  async function loadTree() {
    try {
      const csv = await fetchCsv(TREE_URL_PRIMARY);
      buildTreeFromCsv(csv);
      renderTreeColumns();
      return;
    } catch (e) {}

    try {
      const csv = await fetchCsv(TREE_URL_FALLBACK);
      buildTreeFromCsv(csv);
      renderTreeColumns();
    } catch (e2) {
      treeReady = false;
      renderTreeColumns();
    }
  }

  // =========================================================
  //  Miss Notice (location.csv G/H) : auto build 2-level tree
  // =========================================================
  let missReady = false;
  let missParents = []; // G
  let missChildrenMap = new Map(); // G -> [H...]
  let missActiveParent = "";
  let selectedMiss = new Set(); // token "G\u0001H"

  function missTok(g, h) {
    const G = normalize(g);
    const H = normalize(h);
    return `${G}\u0001${H}`;
  }

  function saveMissSelection() {
    try {
      localStorage.setItem(STORAGE_KEY_MISS, JSON.stringify(Array.from(selectedMiss)));
    } catch (e) {}
  }

  function loadMissSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MISS);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) selectedMiss = new Set(arr.map((x) => String(x)).filter(Boolean));
    } catch (e) {}
  }

  function clearMissSelection() {
    selectedMiss = new Set();
    saveMissSelection();
  }

  function buildMissFromCsv(csvText) {
    missParents = [];
    missChildrenMap = new Map();
    missActiveParent = "";
    missReady = false;

    const lines = String(csvText || "").replace(/\r/g, "").split("\n").filter((l) => l !== "");
    if (!lines.length) return;

    // ヘッダー判定（title/lat/lng/url 等が含まれる場合はスキップ）
    let startIdx = 0;
    try {
      const hcols = csvParseLine(lines[0]).map((s) => normalize(s).toLowerCase());
      if (hcols.some((x) => x.includes("title") || x.includes("lat") || x.includes("lng") || x.includes("url"))) {
        startIdx = 1;
      }
    } catch (e) {}

    const order = [];
    const seen = new Set();

    for (let i = startIdx; i < lines.length; i++) {
      let cols = [];
      try {
        cols = csvParseLine(lines[i]);
      } catch (e) {
        continue;
      }
      // G/H（0-based 6,7）
      const g = normalize(cols[6]);
      const h = normalize(cols[7]);
      if (!g) continue;

      if (!seen.has(g)) {
        seen.add(g);
        order.push(g);
      }
      if (!missChildrenMap.has(g)) missChildrenMap.set(g, []);
      if (h) missChildrenMap.get(g).push(h);
    }

    order.forEach((g) => {
      missChildrenMap.set(g, uniqKeepOrder(missChildrenMap.get(g) || []));
    });

    missParents = order;
    missActiveParent = missParents[0] || "";
    missReady = true;
  }

  function renderMissColumns() {
    if (!colWrapMiss) return;

    colWrapMiss.innerHTML = "";

    if (!missReady) {
      const msg = document.createElement("div");
      msg.textContent = "見逃し注意のデータを読み込み中です…";
      msg.style.padding = "10px";
      msg.style.opacity = "0.8";
      colWrapMiss.appendChild(msg);
      return;
    }

    // 左：G
    const colP = document.createElement("div");
    colP.className = "miss-filter-col";

    const pTitle = document.createElement("div");
    pTitle.className = "tag-filter-col-title";
    pTitle.textContent = "第1カテゴリ";
    colP.appendChild(pTitle);

    const pList = document.createElement("div");
    pList.className = "tag-filter-list";

    missParents.forEach((g) => {
      const item = document.createElement("div");
      item.className = "tag-item";
      if (g === missActiveParent) item.classList.add("is-active-parent");

      const lbl = document.createElement("label");
      lbl.textContent = g;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedMiss.has(missTok(g, ""));

      cb.addEventListener("change", () => {
        const tok = missTok(g, "");
        if (selectedMiss.has(tok)) selectedMiss.delete(tok);
        else selectedMiss.add(tok);
        saveMissSelection();
        setBadge();
      });

      item.addEventListener("click", (e) => {
        if (e.target === cb) return;
        missActiveParent = g;
        renderMissColumns();
      });

      item.appendChild(lbl);
      item.appendChild(cb);
      pList.appendChild(item);
    });

    colP.appendChild(pList);

    // 右：H
    const colC = document.createElement("div");
    colC.className = "miss-filter-col";

    const cTitle = document.createElement("div");
    cTitle.className = "tag-filter-col-title";
    cTitle.textContent = "第2カテゴリ";
    colC.appendChild(cTitle);

    const cList = document.createElement("div");
    cList.className = "tag-filter-list";

    const kids = missChildrenMap.get(missActiveParent) || [];
    kids.forEach((h) => {
      const item = document.createElement("div");
      item.className = "tag-item";

      const lbl = document.createElement("label");
      lbl.textContent = h;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selectedMiss.has(missTok(missActiveParent, h));

      cb.addEventListener("change", () => {
        const tok = missTok(missActiveParent, h);
        if (selectedMiss.has(tok)) selectedMiss.delete(tok);
        else selectedMiss.add(tok);
        saveMissSelection();
        setBadge();
      });

      item.appendChild(lbl);
      item.appendChild(cb);
      cList.appendChild(item);
    });

    colC.appendChild(cList);

    colWrapMiss.appendChild(colP);
    colWrapMiss.appendChild(colC);
  }

  async function loadLocation() {
    if (!colWrapMiss) return;
    try {
      const csv = await fetchCsv(LOCATION_URL_PRIMARY);
      buildMissFromCsv(csv);
      renderMissColumns();
      return;
    } catch (e) {}

    try {
      const csv = await fetchCsv(LOCATION_URL_FALLBACK);
      buildMissFromCsv(csv);
      renderMissColumns();
    } catch (e2) {
      missReady = false;
      renderMissColumns();
    }
  }

  // =========================================================
  //  Apply / Clear (排他)
  // =========================================================
  function setAppliedMode(mode) {
    try {
      const m = mode === MODE_MISS ? MODE_MISS : mode === MODE_TREE ? MODE_TREE : "none";
      localStorage.setItem(STORAGE_KEY_APPLIED_MODE, m);
    } catch (e) {}
  }

  function getAppliedMode() {
    try {
      const v = localStorage.getItem(STORAGE_KEY_APPLIED_MODE);
      if (v === MODE_MISS) return MODE_MISS;
      if (v === MODE_TREE) return MODE_TREE;
      return "none";
    } catch (e) {
      return "none";
    }
  }

  function collectTreeLabels() {
    const out = [];
    for (const id of selectedTree) {
      const t = label.get(id);
      if (t) out.push(t);
    }
    return uniqKeepOrder(out);
  }

  function collectMissPairs() {
    // { g, h } の配列（h空は親のみ）
    const out = [];
    for (const tok of selectedMiss) {
      const parts = String(tok).split("\u0001");
      const g = normalize(parts[0]);
      const h = normalize(parts[1]);
      if (!g) continue;
      out.push({ g, h });
    }
    // 重複排除（文字列キーで）
    const seen = new Set();
    const cleaned = [];
    for (const p of out) {
      const k = `${p.g}\u0001${p.h}`;
      if (seen.has(k)) continue;
      seen.add(k);
      cleaned.push(p);
    }
    return cleaned;
  }

  function postToEarth(payload) {
    try {
      iframe.contentWindow.postMessage(payload, "*");
    } catch (e) {}
  }

  function applyTreeToEarth() {
    const tags = collectTreeLabels();
    postToEarth({ type: "dd-tags-apply", tags, mode: MODE_TREE });
  }

  function applyMissToEarth() {
    const miss = collectMissPairs();
    postToEarth({ type: "dd-miss-apply", miss, mode: MODE_MISS });
  }

  function clearEarthFilters() {
    // earth 側を必ず全表示に戻す
    postToEarth({ type: "dd-filter-clear", mode: "none" });
  }

  applyBtn.addEventListener("click", () => {
    // 排他：どちらか一方だけを「適用中」にする
    if (!hasTabs) {
      // 旧UI互換：treeだけ
      saveTreeSelection();
      setAppliedMode(MODE_TREE);
      applyTreeToEarth();
      closeModal();
      return;
    }

    if (activeMode === MODE_TREE) {
      saveTreeSelection();
      setAppliedMode(MODE_TREE);
      applyTreeToEarth();
    } else {
      saveMissSelection();
      setAppliedMode(MODE_MISS);
      applyMissToEarth();
    }
    setBadge();
    closeModal();
  });

  clearBtn.addEventListener("click", () => {
    if (!hasTabs) {
      clearTreeSelection();
      setAppliedMode("none");
      renderTreeColumns();
      clearEarthFilters();
      setBadge();
      return;
    }

    if (activeMode === MODE_TREE) {
      clearTreeSelection();
      renderTreeColumns();
    } else {
      clearMissSelection();
      renderMissColumns();
    }
    setAppliedMode("none");
    clearEarthFilters();
    setBadge();
  });

  // =========================================================
  //  Auto apply (earth ready)
  // =========================================================
  let earthReady = false;

  function tryAutoApply() {
    if (!earthReady) return;
    const m = getAppliedMode();
    if (m === MODE_TREE) applyTreeToEarth();
    else if (m === MODE_MISS) applyMissToEarth();
  }

  // iframe load
  iframe.addEventListener("load", () => {
    earthReady = true;
    tryAutoApply();
  });

  // earth → parent ready message (earth.html が送る)
  window.addEventListener("message", (ev) => {
    try {
      const d = ev && ev.data ? ev.data : null;
      if (!d) return;
      if ((d.type || "").toString() === "dd-earth-ready") {
        earthReady = true;
        tryAutoApply();
      }
    } catch (e) {}
  });

  // =========================================================
  //  Render
  // =========================================================
  function renderAll() {
    renderTreeColumns();
    if (hasTabs) renderMissColumns();
  }

  // =========================================================
  //  Init
  // =========================================================
  loadTreeSelection();
  loadMissSelection();
  setBadge();

  loadTree();
  if (hasTabs) loadLocation();
})();
