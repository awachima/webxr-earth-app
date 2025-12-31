(function () {
  // ----------------------------
  //  Tag Filter Modal (tree.csv) + Location(G/H) preload
  // ----------------------------

  const STORAGE_KEY_TREE = "dd_filter_tree_selected_v1";
  const STORAGE_KEY_MISS = "dd_filter_miss_selected_v1";
  const STORAGE_KEY_APPLIED_MODE = "dd_filter_applied_mode_v1"; // 'tree' | 'miss' | 'none'

  const MODE_TREE = "tree";
  const MODE_MISS = "miss";
  const MODE_NONE = "none";

  const SELECTOR_IFRAME = "iframe#earthFrame";

  const TREE_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";
  const TREE_URL_FALLBACK = "./tree.csv";

  // ★追加: location.csv（G/Hを追加カテゴリに使う）
  const LOCATION_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=717261533&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

  // ----------------------------
  //  DOM
  // ----------------------------
  const btn = document.getElementById("tagFilterBtn");
  const badge = document.getElementById("tagFilterBadge");
  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = document.getElementById("tagFilterModal");
  const closeBtn = document.getElementById("tagFilterClose");
  const applyBtn = document.getElementById("tagFilterApply");
  const clearBtn = document.getElementById("tagFilterClear");
  const colWrap = document.getElementById("tagFilterColumns");
  const locArea = document.getElementById("tagFilterLocArea"); // 追加カテゴリ（location.csv G/H）表示先
  const iframe = document.querySelector(SELECTOR_IFRAME);

  if (!btn || !badge || !backdrop || !modal || !closeBtn || !colWrap || !iframe) {
    return;
  }

  // ----------------------------
  //  State
  // ----------------------------
  let treeReady = false;

  // tree nodes
  const ROOT_ID = "__root__";
  const children = new Map(); // id -> [childId...]
  const label = new Map(); // id -> text
  const parent = new Map(); // id -> parentId
  const depth = new Map(); // id -> 1..3

  // selection
  const selected = new Set(); // ids
  let appliedMode = MODE_NONE; // tree | miss | none
  let missSelected = new Set(); // miss filter selections (existing)

  // post throttling
  let postTimer = null;

  // ----------------------------
  //  Helpers
  // ----------------------------
  function normalize(s) {
    return (s || "").trim();
  }

  function csvParseLine(line) {
    // simple CSV parser that supports quotes
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

  function ensureSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  // ----------------------------
  //  location.csv(G/H) -> extra category UI
  // ----------------------------
  const LOC_G_INDEX = 6; // G列（0始まり）
  const LOC_H_INDEX = 7; // H列（0始まり）

  let locReady = false;
  let locGList = []; // ["街", "自然", ...]
  let locChildren = new Map(); // G -> Set(H)
  let locOpenG = null; // 右ペインに出す対象G

  // location.csv の先読み（同時多重fetch防止）
  let locLoadPromise = null;

  function ensureLocationCatsLoaded() {
    if (!locArea) return Promise.resolve(); // UI未対応でも落とさない
    if (locReady) return Promise.resolve();
    if (locLoadPromise) return locLoadPromise;

    locLoadPromise = (async () => {
      await loadLocationCats();
    })().finally(() => {
      locLoadPromise = null;
    });

    return locLoadPromise;
  }

  async function loadLocationCats() {
    if (!locArea) return; // index.html側が未対応でも落とさない

    let text = "";

    // Primary（Google Sheets CSV）
    try {
      const r = await fetch(LOCATION_URL_PRIMARY, { cache: "no-store" });
      if (r.ok) text = await r.text();
    } catch (_) {}

    // Fallback（同階層の location.csv）
    if (!text) {
      try {
        const r2 = await fetch(LOCATION_URL_FALLBACK, { cache: "no-store" });
        if (r2.ok) text = await r2.text();
      } catch (_) {}
    }

    if (!text) {
      // 読めない場合でもUI箱は残す（空表示）
      locReady = false;
      renderLocArea();
      return;
    }

    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) {
      locReady = false;
      renderLocArea();
      return;
    }

    // ヘッダー判定（2列目/3列目が数値でないならヘッダー扱い）
    let start = 0;
    try {
      const head = csvParseLine(lines[0]); // 既存Helperを利用
      const lat = parseFloat((head[1] || "").replace(/[−–‐]/g, "-"));
      const lng = parseFloat((head[2] || "").replace(/[−–‐]/g, "-"));
      if (isNaN(lat) || isNaN(lng)) start = 1;
    } catch (_) {}

    const gSet = new Set();
    const childMap = new Map();

    for (let i = start; i < lines.length; i++) {
      const parts = csvParseLine(lines[i]);
      const g = normalize(parts[LOC_G_INDEX]);
      const h = normalize(parts[LOC_H_INDEX]);
      if (!g) continue;

      gSet.add(g);
      if (!childMap.has(g)) childMap.set(g, new Set());
      if (h) childMap.get(g).add(h);

      // ★重要: postSelected() は label を送るので、ここで label 登録しておく
      // G/H は「表示名 = タグ名」をそのまま扱う（earth側tagsに入れるため）
      label.set("loc::g::" + g, g);
      if (h) label.set("loc::h::" + g + "::" + h, h);
    }

    locGList = Array.from(gSet).sort((a, b) => a.localeCompare(b, "ja"));
    locChildren = childMap;
    locOpenG = locOpenG && childMap.has(locOpenG) ? locOpenG : locGList[0] || null;

    locReady = true;
    renderLocArea();
  }

  function renderLocArea() {
    if (!locArea) return;

    locArea.innerHTML = "";

    const left = document.createElement("div");
    left.className = "tag-filter-loccol";
    const right = document.createElement("div");
    right.className = "tag-filter-loccol";

    const hL = document.createElement("h3");
    hL.textContent = "追加カテゴリ（第1）";
    left.appendChild(hL);

    const hR = document.createElement("h3");
    hR.textContent = "追加カテゴリ（第2）";
    right.appendChild(hR);

    if (!locReady) {
      const msg = document.createElement("div");
      msg.style.opacity = "0.7";
      msg.style.padding = "6px 2px";
      msg.textContent = "読み込み中…";
      left.appendChild(msg);

      locArea.appendChild(left);
      locArea.appendChild(right);
      return;
    }

    // 左: G一覧（クリックで右を切替、チェックで選択）
    locGList.forEach((g) => {
      const row = makeLocRow("loc::g::" + g, g, true);
      row.addEventListener("click", () => {
        locOpenG = g;
        renderLocArea();
      });
      left.appendChild(row);
    });

    // 右: 選択中Gの子（H一覧）
    const setH = locOpenG ? locChildren.get(locOpenG) || new Set() : new Set();
    Array.from(setH)
      .sort((a, b) => a.localeCompare(b, "ja"))
      .forEach((h) => {
        const id = "loc::h::" + locOpenG + "::" + h;
        const row = makeLocRow(id, h, false);
        right.appendChild(row);
      });

    locArea.appendChild(left);
    locArea.appendChild(right);
  }

  function makeLocRow(id, text, isG) {
    // 既存の .node デザインに合わせる（renderColumns() と同系統）
    const row = document.createElement("div");
    row.className = "node";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(id);

    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = text;

    const chev = document.createElement("div");
    chev.className = "chev";
    chev.textContent = isG ? "›" : "";

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = cb.checked;

      // GをON/OFFしたら、その配下のHもまとめてON/OFF（“Gの子”ルール）
      if (id.startsWith("loc::g::")) {
        const g = text;

        if (on) selected.add(id);
        else selected.delete(id);

        const kids = locChildren.get(g) || new Set();
        kids.forEach((h) => {
          const hid = "loc::h::" + g + "::" + h;
          if (on) selected.add(hid);
          else selected.delete(hid);
        });
      } else {
        if (on) selected.add(id);
        else selected.delete(id);
      }

      saveSelection();
      setBadge();

      // 既存カラムのチェック状態も矛盾しないよう更新
      renderColumns();

      // 追加カテゴリも更新
      renderLocArea();

      schedulePostSelected();
    });

    return row;
  }

  // ----------------------------
  //  Tree load / build
  // ----------------------------
  async function fetchCsv(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error("fetch failed: " + r.status);
    return await r.text();
  }

  function addNode(id, text, parentId, d) {
    label.set(id, text);
    parent.set(id, parentId);
    depth.set(id, d);

    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(id);

    if (!children.has(id)) children.set(id, []);
  }

  function buildTreeFromCsv(csv) {
    children.clear();
    label.clear();
    parent.clear();
    depth.clear();

    children.set(ROOT_ID, []);
    label.set(ROOT_ID, "root");
    depth.set(ROOT_ID, 0);

    const lines = csv.trim().split(/\r?\n/);
    if (!lines.length) return;

    // header detection
    let start = 0;
    try {
      const head = csvParseLine(lines[0]);
      if (head && head.length >= 1 && normalize(head[0]) === "L1") {
        start = 1;
      }
    } catch (_) {}

    const idMap = new Map(); // key "d|text|parentId" -> id
    let seq = 0;

    function getOrCreate(text, parentId, d) {
      const key = d + "|" + text + "|" + parentId;
      if (idMap.has(key)) return idMap.get(key);
      const id = "n" + (++seq);
      idMap.set(key, id);
      addNode(id, text, parentId, d);
      return id;
    }

    for (let i = start; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]);
      const l1 = normalize(cols[0]);
      const l2 = normalize(cols[1]);
      const l3 = normalize(cols[2]);

      let p = ROOT_ID;

      if (l1) {
        const id1 = getOrCreate(l1, ROOT_ID, 1);
        p = id1;
      } else {
        continue; // L1 empty = skip line
      }

      if (l2) {
        const id2 = getOrCreate(l2, p, 2);
        p = id2;
      } else {
        continue; // L2 empty = skip deeper
      }

      if (l3) {
        getOrCreate(l3, p, 3);
      }
    }

    // sort children lists
    for (const [pid, arr] of children.entries()) {
      arr.sort((a, b) => {
        const ta = label.get(a) || "";
        const tb = label.get(b) || "";
        return ta.localeCompare(tb, "ja");
      });
      children.set(pid, arr);
    }
  }

  // ----------------------------
  //  Selection persistence
  // ----------------------------
  function saveSelection() {
    const arr = Array.from(selected.values());
    localStorage.setItem(STORAGE_KEY_TREE, JSON.stringify(arr));
    localStorage.setItem(STORAGE_KEY_APPLIED_MODE, MODE_TREE);
    appliedMode = MODE_TREE;
  }

  function loadSelection() {
    // mode
    const m = localStorage.getItem(STORAGE_KEY_APPLIED_MODE);
    if (m === MODE_MISS) appliedMode = MODE_MISS;
    else if (m === MODE_TREE) appliedMode = MODE_TREE;
    else appliedMode = MODE_NONE;

    // tree
    try {
      const s = localStorage.getItem(STORAGE_KEY_TREE);
      const arr = JSON.parse(s || "[]");
      selected.clear();
      arr.forEach((id) => selected.add(id));
    } catch (_) {
      selected.clear();
    }

    // miss
    try {
      const s2 = localStorage.getItem(STORAGE_KEY_MISS);
      const arr2 = JSON.parse(s2 || "[]");
      missSelected = new Set(arr2);
    } catch (_) {
      missSelected = new Set();
    }
  }

  // ----------------------------
  //  Badge
  // ----------------------------
  function setBadge() {
    // バッジは不要（CSSで非表示の想定）
    // 一応内部的には更新しておく
    let n = 0;
    if (appliedMode === MODE_TREE) n = selected.size;
    else if (appliedMode === MODE_MISS) n = missSelected.size;
    badge.textContent = n ? String(n) : "";
  }

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal() {
    backdrop.style.display = "block";
    modal.style.display = "block";
    // Columns render
    renderColumns();
    // show loc content (if loaded)
    renderLocArea();
  }

  function closeModal() {
    backdrop.style.display = "none";
    modal.style.display = "none";
  }

  // ----------------------------
  //  Render UI (3 columns)
  // ----------------------------
  function createColumn(title) {
    const col = document.createElement("div");
    col.className = "tag-filter-col";
    const h = document.createElement("h2");
    h.textContent = title;
    col.appendChild(h);
    const list = document.createElement("div");
    list.className = "tag-filter-list";
    col.appendChild(list);
    return col;
  }

  function getListEl(col) {
    return col.querySelector(".tag-filter-list");
  }

  function isChecked(id) {
    return selected.has(id);
  }

  function hasSelectedDescendant(id) {
    const kids = children.get(id) || [];
    for (const k of kids) {
      if (selected.has(k)) return true;
      if (hasSelectedDescendant(k)) return true;
    }
    return false;
  }

  function isIndeterminate(id) {
    const kids = children.get(id) || [];
    if (!kids.length) return false;
    const any = kids.some((k) => selected.has(k) || isIndeterminate(k) || hasSelectedDescendant(k));
    const all = kids.every((k) => selected.has(k) && !isIndeterminate(k));
    return any && !all && !selected.has(id);
  }

  function toggleWithChildren(id, on) {
    if (on) selected.add(id);
    else selected.delete(id);

    const kids = children.get(id) || [];
    kids.forEach((k) => toggleWithChildren(k, on));
  }

  // clicked to show next column
  let currentPath = [ROOT_ID]; // [root, l1, l2]
  function setPath(level, id) {
    currentPath = currentPath.slice(0, level);
    currentPath[level] = id;
    renderColumns();
  }

  function renderList(col, parentId, level, checkedMap, indMap) {
    const list = getListEl(col);
    list.innerHTML = "";

    const kids = children.get(parentId) || [];
    kids.forEach((id) => {
      const row = document.createElement("div");
      row.className = "node";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !!checkedMap.get(id);
      cb.indeterminate = !!indMap.get(id);

      const lab = document.createElement("div");
      lab.className = "label";
      lab.textContent = label.get(id) || "";

      const chev = document.createElement("div");
      chev.className = "chev";
      chev.textContent = level < 3 ? "›" : "";

      row.appendChild(cb);
      row.appendChild(lab);
      row.appendChild(chev);

      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = cb.checked;
        toggleWithChildren(id, on);

        saveSelection();
        setBadge();
        renderColumns();
        schedulePostSelected();
      });

      row.addEventListener("click", () => {
        if (level < 3) setPath(level, id);
      });

      list.appendChild(row);
    });
  }

  function renderColumns() {
    colWrap.innerHTML = "";

    // compute checked/indeterminate for all nodes
    const checked = new Map();
    const indeterminate = new Map();

    for (const [id] of label.entries()) {
      if (id === ROOT_ID) continue;
      checked.set(id, isChecked(id));
      indeterminate.set(id, isIndeterminate(id));
    }

    // columns
    const col1 = createColumn("カテゴリ");
    renderList(col1, ROOT_ID, 1, checked, indeterminate);

    // ▼▼ 追加カテゴリ（location.csv G/H）を「カテゴリ枠(col1)の中」に入れる ▼▼
    if (locArea) {
      if (locArea.parentNode) locArea.parentNode.removeChild(locArea);
      locArea.classList.add("loc-area-in-col1");
      col1.appendChild(locArea);
    }
    // ▲▲ ここまで ▲▲

    const col2 = createColumn(currentPath[1] ? (label.get(currentPath[1]) || "") : "");
    const p2 = currentPath[1] || null;
    if (p2) renderList(col2, p2, 2, checked, indeterminate);

    const col3 = createColumn(currentPath[2] ? (label.get(currentPath[2]) || "") : "");
    const p3 = currentPath[2] || null;
    if (p3) renderList(col3, p3, 3, checked, indeterminate);

    const cols = [col1, col2, col3];
    cols.forEach((c) => colWrap.appendChild(c));
  }

  // ----------------------------
  //  postMessage to earth
  // ----------------------------
  function schedulePostSelected() {
    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      postTimer = null;
      postSelected();
    }, 120);
  }

  function postSelected() {
    const mode = appliedMode;

    if (!iframe || !iframe.contentWindow) return;

    if (mode === MODE_TREE) {
      // send selected labels (not ids)
      const tags = [];
      selected.forEach((id) => {
        const t = label.get(id);
        if (t) tags.push(t);
      });

      iframe.contentWindow.postMessage(
        {
          type: "dd-filter",
          mode: MODE_TREE,
          tags,
        },
        "*"
      );
    } else if (mode === MODE_MISS) {
      iframe.contentWindow.postMessage(
        {
          type: "dd-filter",
          mode: MODE_MISS,
          miss: Array.from(missSelected),
        },
        "*"
      );
    } else {
      iframe.contentWindow.postMessage(
        {
          type: "dd-filter",
          mode: MODE_NONE,
        },
        "*"
      );
    }
  }

  // ----------------------------
  //  Apply/Clear
  // ----------------------------
  function applyTree() {
    appliedMode = MODE_TREE;
    localStorage.setItem(STORAGE_KEY_APPLIED_MODE, MODE_TREE);
    saveSelection();
    setBadge();
    postSelected();
    closeModal();
  }

  function clearAll() {
    selected.clear();
    missSelected = new Set();
    appliedMode = MODE_NONE;

    localStorage.removeItem(STORAGE_KEY_TREE);
    localStorage.removeItem(STORAGE_KEY_MISS);
    localStorage.setItem(STORAGE_KEY_APPLIED_MODE, MODE_NONE);

    setBadge();
    renderColumns();
    renderLocArea();
    postSelected();
  }

  function tryAutoApply() {
    // 初回表示など、必要なら呼び出すだけ
    postSelected();
  }

  // ----------------------------
  //  Events
  // ----------------------------
  btn.addEventListener("click", () => {
    openModal();
  });

  closeBtn.addEventListener("click", () => {
    closeModal();
  });

  backdrop.addEventListener("click", () => {
    closeModal();
  });

  applyBtn.addEventListener("click", () => {
    applyTree();
  });

  clearBtn.addEventListener("click", () => {
    clearAll();
  });

  // ----------------------------
  //  Load
  // ----------------------------
  async function loadTree() {
    treeReady = false;
    try {
      const csv = await fetchCsv(TREE_URL_PRIMARY);
      buildTreeFromCsv(csv);
      treeReady = true;
      await ensureLocationCatsLoaded(); // ★先読み（重複fetch防止）
      renderColumns();
      tryAutoApply();
      return;
    } catch (e) {}

    try {
      const csv = await fetchCsv(TREE_URL_FALLBACK);
      buildTreeFromCsv(csv);
      treeReady = true;
      await ensureLocationCatsLoaded(); // ★先読み（重複fetch防止）
      renderColumns();
      tryAutoApply();
    } catch (e2) {
      treeReady = false;
    }
  }

  // ----------------------------
  //  Init
  // ----------------------------
  loadSelection();
  setBadge();

  // ★先読み：モーダルを開く前に location.csv(G/H) を取得しておく
  ensureLocationCatsLoaded();

  loadTree();
})();
