(function () {
  // ----------------------------
  //  Tag Filter (Tree / Columns)
  // ----------------------------
  const STORAGE_KEY = "dd_selected_tags_v1";

  // 見逃し注意（location.csv G/H）
  const STORAGE_KEY_MISS = "dd_miss_notice_v1";
  // どちらが適用中か（排他）
  const STORAGE_KEY_APPLIED_MODE = "dd_filter_applied_mode_v1"; // 'tree' | 'miss' | 'none'

  // 見逃し注意用のCSV（公開URLは環境に合わせて差し替え）
  const LOCATION_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=717261533&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

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

  // 統合モーダルUI（新規）
  const tabTreeBtn = document.getElementById("ddFilterTabTree");
  const tabMissBtn = document.getElementById("ddFilterTabMiss");
  const paneTree = document.getElementById("ddPaneTree");
  const paneMiss = document.getElementById("ddPaneMiss");
  const missColWrap = document.getElementById("missFilterColumns");

  const iframe = document.getElementById("webxr-iframe");

  // ★ 必須要素だけチェック（apply/clear は無くても動かす）
  if (!btn || !badge || !backdrop || !modal || !closeBtn || !colWrap || !iframe) {
    return;
  }

  // ----------------------------
  //  Mode (排他)
  // ----------------------------
  const MODE_TREE = "tree";
  const MODE_MISS = "miss";

  // 初期状態：必ず「絞り込み（A）」を編集対象にする
  let activeMode = MODE_TREE;

  function setActiveMode(mode) {
    activeMode = mode === MODE_MISS ? MODE_MISS : MODE_TREE;

    // CSS用（data-active-mode）
    backdrop.dataset.activeMode = activeMode;

    // タブの見た目/aria
    if (tabTreeBtn) {
      tabTreeBtn.classList.toggle("is-active", activeMode === MODE_TREE);
      tabTreeBtn.setAttribute("aria-selected", activeMode === MODE_TREE ? "true" : "false");
    }
    if (tabMissBtn) {
      tabMissBtn.classList.toggle("is-active", activeMode === MODE_MISS);
      tabMissBtn.setAttribute("aria-selected", activeMode === MODE_MISS ? "true" : "false");
    }

    // PC左右2ペイン：非アクティブ側は「操作不可に見せる」
    if (paneTree) paneTree.classList.toggle("is-inactive", activeMode !== MODE_TREE);
    if (paneMiss) paneMiss.classList.toggle("is-inactive", activeMode !== MODE_MISS);
  }

  // タブ切替（スマホ/PC共通）
  if (tabTreeBtn) tabTreeBtn.addEventListener("click", () => setActiveMode(MODE_TREE));
  if (tabMissBtn) tabMissBtn.addEventListener("click", () => setActiveMode(MODE_MISS));

  // ----------------------------
  //  Earth ready / auto apply
  // ----------------------------
  let earthReady = false;
  // 自動適用（リロード時に earth 側へ再送）
  let hadSavedSelection = false;

  function markEarthReadyFromIframe() {
    if (earthReady) return;
    earthReady = true;
    tryAutoApply();
  }

  // 通常: iframe load で確実に検知
  iframe.addEventListener("load", () => {
    markEarthReadyFromIframe();
  });

  // 既に読み込み済み（load が先に終わっている）ケースも拾う
  setTimeout(() => {
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
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
      postSelected();
    }, delayMs);
  }

  // ----------------------------
  //  CSV helpers
  // ----------------------------
  function normalize(s) {
    return String(s || "").trim();
  }

  function safeIdFromLabel(parts) {
    // 既存互換：ラベルをID化（区切りは " › "）
    return parts.map((p) => normalize(p)).filter(Boolean).join(" › ");
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
    // 数字表示は不要だが、既存互換のため処理は残す（CSS側で非表示）
    try {
      if (selected.size <= 0) {
        badge.textContent = "";
        badge.style.display = "none";
        return;
      }
      badge.textContent = `(${selected.size})`;
      badge.style.display = "inline";
    } catch (e) {}
  }

  function saveSelection() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(Array.from(selected).filter((id) => id && id !== ROOT_ID && id !== EMPTY_ID))
      );
    } catch (e) {}
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        selected = new Set(
          arr.map((x) => String(x)).filter((id) => id && id !== ROOT_ID && id !== EMPTY_ID)
        );
        hadSavedSelection = selected.size > 0;
      }
    } catch (e) {}
  }

  function saveMissSelection() {
    try {
      localStorage.setItem(STORAGE_KEY_MISS, JSON.stringify(Array.from(missSelected)));
    } catch (e) {}
  }

  function loadMissSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_MISS);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        missSelected = new Set(arr.map((x) => String(x)).filter(Boolean));
      }
    } catch (e) {}
  }

  function setAppliedMode(mode) {
    try {
      const m = mode === MODE_MISS ? MODE_MISS : mode === MODE_TREE ? MODE_TREE : "none";
      localStorage.setItem(STORAGE_KEY_APPLIED_MODE, m);
    } catch (e) {}
  }

  // ----------------------------
  //  Tree structure
  // ----------------------------
  const label = new Map(); // id -> label
  const parent = new Map(); // id -> parentId
  const children = new Map(); // parentId -> Set(childId)
  const depthById = new Map(); // id -> depth (1..)
  const pathById = new Map(); // id -> ancestors array (ids)

  // root pseudo id
  const ROOT_ID = "__root__";
  const EMPTY_ID = "__empty__";

  // selection state
  let selected = new Set(); // Set<nodeId>

  // ----------------------------
  //  見逃し注意（G/H）状態
  // ----------------------------
  let missReady = false;
  let missParents = []; // 第1カテゴリ（G）
  let missChildrenMap = new Map(); // G -> [H...]
  let missActiveParent = ""; // 現在開いている親
  let missSelected = new Set(); // token: `${G}\u0001${H}`（H空は親のみ）

  function missTok(g, h) {
    const G = (g || "").toString().trim();
    const H = (h || "").toString().trim();
    return `${G}\u0001${H}`;
  }

  function uniqKeepOrder(arr) {
    const out = [];
    const seen = new Set();
    for (const v0 of arr) {
      const v = (v0 || "").toString().trim();
      if (!v) continue;
      if (seen.has(v)) continue;
      seen.add(v);
      out.push(v);
    }
    return out;
  }

  // 現在開いている経路（列の状態）
  let path = []; // ids per depth

  // 最大深さ（treeは3階層）
  const MAX_DEPTH = 3;

  // tree load state
  let treeReady = false;

  // ----------------------------
  //  Build tree from CSV
  // ----------------------------
  function addNode(parts, depth) {
    const id = safeIdFromLabel(parts);
    if (!id) return null;

    if (!label.has(id)) {
      label.set(id, normalize(parts[parts.length - 1]));
      depthById.set(id, depth);
      const p = depth === 1 ? ROOT_ID : safeIdFromLabel(parts.slice(0, -1));
      parent.set(id, p);

      ensureSet(children, p).add(id);

      // ancestors
      const ancestors = [];
      for (let d = 1; d < depth; d++) {
        ancestors.push(safeIdFromLabel(parts.slice(0, d)));
      }
      pathById.set(id, ancestors);
    }
    return id;
  }

  function getChildren(pid) {
    const set = children.get(pid);
    if (!set) return [];
    return Array.from(set);
  }

  function nodeHasChildren(id) {
    const set = children.get(id);
    return !!(set && set.size);
  }

  function setNodeAndDescendants(id, on) {
    // チェック状態の一括（子孫含む）
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur) continue;

      if (on) selected.add(cur);
      else selected.delete(cur);

      const kids = getChildren(cur);
      for (const k of kids) stack.push(k);
    }
  }

  function computeIndeterminateStates() {
    // indeterminate 判定（親が一部だけON）
    const indeterminate = new Set();

    function walk(nodeId) {
      const kids = getChildren(nodeId);
      if (!kids.length) return selected.has(nodeId) ? 1 : 0;

      let totalOn = 0;
      let totalOff = 0;

      for (const k of kids) {
        const r = walk(k);
        if (r === 1) totalOn++;
        else if (r === 0) totalOff++;
        else {
          // mixed
          indeterminate.add(nodeId);
          return -1;
        }
      }

      if (totalOn === kids.length) {
        // 全部ONなら親もON扱い（見た目）
        return 1;
      }
      if (totalOff === kids.length) {
        // 全部OFFなら親もOFF
        return 0;
      }

      // 一部ON
      indeterminate.add(nodeId);
      return -1;
    }

    walk(ROOT_ID);
    return indeterminate;
  }

  // ----------------------------
  //  Render columns (tree)
  // ----------------------------
  function clearColumns() {
    colWrap.innerHTML = "";
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

  function renderList(listEl, ids, depth, indeterminate) {
    listEl.innerHTML = "";

    for (const id of ids) {
      const item = document.createElement("div");
      item.className = "tag-item";
      item.dataset.id = id;

      const lbl = document.createElement("label");
      lbl.textContent = label.get(id) || "";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(id);
      cb.indeterminate = indeterminate.has(id);

      cb.addEventListener("change", (e) => {
        const on = cb.checked;

        // 子孫もまとめて
        setNodeAndDescendants(id, on);

        // 保存
        saveSelection();
        setBadge();

        // 次の列更新
        renderColumns();

        // 即時送信（apply が無い構成のための保険）
        schedulePostSelected();
      });

      // 行クリックで「その列で選択（開く）」：次列を表示
      item.addEventListener("click", (e) => {
        if (e.target === cb) return;

        // depthの位置に入れる
        path = path.slice(0, depth - 1);
        path[depth - 1] = id;

        renderColumns();
      });

      item.appendChild(lbl);
      item.appendChild(cb);
      listEl.appendChild(item);
    }
  }

  function renderColumns() {
    clearColumns();

    if (!treeReady) {
      const msg = document.createElement("div");
      msg.textContent = "カテゴリを読み込み中です…";
      msg.style.padding = "10px";
      msg.style.opacity = "0.8";
      colWrap.appendChild(msg);
      return;
    }

    const indeterminate = computeIndeterminateStates();

    // depth 1
    const c1 = createColumn("カテゴリ");
    renderList(c1.list, getChildren(ROOT_ID), 1, indeterminate);

    // depth 2
    const pid2 = path[0];
    const c2 = createColumn("サブカテゴリ");
    if (pid2) renderList(c2.list, getChildren(pid2), 2, indeterminate);

    // depth 3
    const pid3 = path[1];
    const c3 = createColumn("詳細");
    if (pid3) renderList(c3.list, getChildren(pid3), 3, indeterminate);

    colWrap.appendChild(c1.col);
    colWrap.appendChild(c2.col);
    colWrap.appendChild(c3.col);
  }

  // ----------------------------
  //  見逃し注意（location.csv G/H）
  // ----------------------------
  function buildMissFromCsv(csvText) {
    missParents = [];
    missChildrenMap = new Map();
    missActiveParent = "";
    missReady = false;

    const lines = String(csvText || "").replace(/\r/g, "").split("\n").filter((l) => l !== "");
    if (!lines.length) return;

    // ヘッダー判定（ありがちなカラム名が含まれる場合のみスキップ）
    let startIdx = 0;
    try {
      const hcols = csvParseLine(lines[0]).map((s) => String(s || "").trim().toLowerCase());
      if (hcols.some((x) => x.includes("title") || x.includes("lat") || x.includes("lng") || x.includes("url"))) {
        startIdx = 1;
      }
    } catch (e) {}

    const parentOrder = [];
    const parentSeen = new Set();

    for (let i = startIdx; i < lines.length; i++) {
      let cols = [];
      try {
        cols = csvParseLine(lines[i]);
      } catch (e) {
        continue;
      }

      // G/H（0-based 6,7）
      const g = String((cols[6] ?? "")).trim();
      const h = String((cols[7] ?? "")).trim();

      if (!g) continue;

      if (!parentSeen.has(g)) {
        parentSeen.add(g);
        parentOrder.push(g);
      }

      if (!missChildrenMap.has(g)) missChildrenMap.set(g, []);
      if (h) missChildrenMap.get(g).push(h);
    }

    // 子は重複除去（出現順維持）
    parentOrder.forEach((g) => {
      const list = missChildrenMap.get(g) || [];
      missChildrenMap.set(g, uniqKeepOrder(list));
    });

    missParents = parentOrder;
    missActiveParent = missParents[0] || "";
    missReady = true;
  }

  function renderMissColumns() {
    if (!missColWrap) return;

    missColWrap.innerHTML = "";

    if (!missReady) {
      const msg = document.createElement("div");
      msg.textContent = "見逃し注意のデータを読み込み中です…";
      msg.style.padding = "10px";
      msg.style.opacity = "0.8";
      missColWrap.appendChild(msg);
      return;
    }

    // 左：第1カテゴリ（G）
    const colP = document.createElement("div");
    colP.className = "miss-filter-col";

    const pTitle = document.createElement("div");
    pTitle.className = "tag-filter-col-title";
    pTitle.textContent = "見逃し注意（第1カテゴリ）";
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
      cb.checked = missSelected.has(missTok(g, ""));

      cb.addEventListener("change", () => {
        const tok = missTok(g, "");
        if (missSelected.has(tok)) missSelected.delete(tok);
        else missSelected.add(tok);
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

    // 右：第2カテゴリ（H）
    const colC = document.createElement("div");
    colC.className = "miss-filter-col";

    const cTitle = document.createElement("div");
    cTitle.className = "tag-filter-col-title";
    cTitle.textContent = "見逃し注意（第2カテゴリ）";
    colC.appendChild(cTitle);

    const cList = document.createElement("div");
    cList.className = "tag-filter-list";

    const children2 = missChildrenMap.get(missActiveParent) || [];
    children2.forEach((h) => {
      const item = document.createElement("div");
      item.className = "tag-item";

      const lbl = document.createElement("label");
      lbl.textContent = h;

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = missSelected.has(missTok(missActiveParent, h));

      cb.addEventListener("change", () => {
        const tok = missTok(missActiveParent, h);
        if (missSelected.has(tok)) missSelected.delete(tok);
        else missSelected.add(tok);
        saveMissSelection();
        setBadge();
      });

      item.appendChild(lbl);
      item.appendChild(cb);
      cList.appendChild(item);
    });

    colC.appendChild(cList);

    missColWrap.appendChild(colP);
    missColWrap.appendChild(colC);
  }

  async function loadLocation() {
    if (!missColWrap) return;
    try {
      const csv1 = await fetchCsv(LOCATION_URL_PRIMARY);
      buildMissFromCsv(csv1);
      renderMissColumns();
    } catch (e) {
      try {
        const csv2 = await fetchCsv(LOCATION_URL_FALLBACK);
        buildMissFromCsv(csv2);
        renderMissColumns();
      } catch (e2) {
        missReady = false;
        renderMissColumns();
      }
    }
  }

  // ----------------------------
  //  Post selected (tree -> earth)
  // ----------------------------
  function postSelected() {
    // earth 側は「タグ文字列配列」を受け取る想定なので、labelに変換して送る
    const tags = [];
    for (const id of selected) {
      const t = label.get(id);
      if (t) tags.push(t);
    }

    try {
      iframe.contentWindow.postMessage({ type: "dd-tags-apply", tags }, "*");
    } catch (e) {}
  }

  function tryAutoApply() {
    if (!earthReady) return;
    if (!hadSavedSelection) return;
    postSelected();
  }

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

    setActiveMode(MODE_TREE);

    renderColumns();
    renderMissColumns();
  }

  function closeModal() {
    backdrop.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");

    // class も display も両方閉じる（どちらの方式でも確実に閉じる）
    backdrop.classList.remove("open");
    backdrop.style.display = "none";

    document.body.style.overflow = "";
  }

  // open button
  btn.addEventListener("click", () => {
    openModal();
  });

  // close
  closeBtn.addEventListener("click", () => {
    closeModal();
  });

  // click outside closes
  backdrop.addEventListener("mousedown", (e) => {
    if (e.target === backdrop) closeModal();
  });

  // ★ apply/clear がある構成だけイベントを生やす
  if (applyBtn) {
    applyBtn.addEventListener("click", () => {
      // 排他：どちらか一方だけを「適用中」にする
      if (activeMode === MODE_TREE) {
        saveSelection();
        setAppliedMode(MODE_TREE);
        setBadge();
        postSelected();
      } else {
        saveMissSelection();
        setAppliedMode(MODE_MISS);
        setBadge();
        // Phase 1：見逃し注意は earth へは送らない（次フェーズで連携）
      }
      closeModal();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (activeMode === MODE_TREE) {
        selected = new Set();
        path = [];
        saveSelection();
        renderColumns();
      } else {
        missSelected = new Set();
        saveMissSelection();
        renderMissColumns();
      }
      setAppliedMode("none");
      setBadge();
    });
  }

  // esc closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && backdrop.classList.contains("open")) {
      closeModal();
    }
  });

  // ----------------------------
  //  Load tree (CSV)
  // ----------------------------
  async function fetchCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed");
    return await res.text();
  }

  function buildTreeFromCsv(csvText) {
    label.clear();
    parent.clear();
    children.clear();
    depthById.clear();
    pathById.clear();

    // root
    label.set(ROOT_ID, "");
    depthById.set(ROOT_ID, 0);
    parent.set(ROOT_ID, null);

    const lines = String(csvText || "").replace(/\r/g, "").split("\n").filter((l) => l !== "");

    for (const line of lines) {
      const cols = csvParseLine(line).map((c) => normalize(c));

      // 3列想定（最大）
      const a = cols[0] || "";
      const b = cols[1] || "";
      const c = cols[2] || "";

      // 全空行は無視
      if (!a && !b && !c) continue;

      const parts = [];
      if (a) {
        parts.push(a);
        addNode(parts, 1);
      } else {
        // 第1階層が空は壊れやすいのでスキップ
        continue;
      }

      if (b) {
        parts.push(b);
        addNode(parts, 2);
      }

      if (c) {
        parts.push(c);
        addNode(parts, 3);
      }
    }

    treeReady = true;
  }

  async function loadTree() {
    try {
      const csv = await fetchCsv(TREE_URL_PRIMARY);
      buildTreeFromCsv(csv);
      renderColumns();
      tryAutoApply();
      return;
    } catch (e) {}

    try {
      const csv = await fetchCsv(TREE_URL_FALLBACK);
      buildTreeFromCsv(csv);
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
  loadMissSelection();
  setBadge();
  loadTree();
  loadLocation();
})();
