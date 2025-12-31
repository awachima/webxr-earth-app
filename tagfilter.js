(function () {
  // ----------------------------
  //  Tag Filter (tree.csv) + Additional Tags (location.csv G/H..)
  //  - 3カラム（最大3階層）
  //  - 「追加カテゴリ(第2)」は location.csv の G/H を利用（公開CSVに含まれる前提）
  //  - apply(適用) で earth.html へ postMessage
  // ----------------------------

  const STORAGE_KEY_TREE = "dd_filter_tree_selected_v1";
  const STORAGE_KEY_LOC = "dd_filter_loc_selected_v1";
  const STORAGE_KEY_APPLIED_MODE = "dd_filter_applied_mode_v1"; // 'tree' | 'loc' | 'none'

  const MODE_TREE = "tree";
  const MODE_LOC = "loc";
  const MODE_NONE = "none";

  // tree CSV (公開URL) - sheet name "tree"
  // 既存の実装に合わせて URL を固定（必要なら差し替えてください）
  const TREE_CSV_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";

  // location CSV - user supplied
  // ★ index.html から読み込む location.csv と同じものを参照したい場合は、ここを合わせてください
  // 今回は既存ロジックに合わせ、earth 側と同じ fetch 経路を使えるよう相対パス想定のままにしています
  const LOCATION_CSV_URL = "./location.csv";

  // UI elements
  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = backdrop ? backdrop.querySelector(".tag-filter-modal") : null;
  const closeBtn = document.getElementById("tagFilterClose");
  const applyBtn = document.getElementById("tagFilterApply");
  const clearBtn = document.getElementById("tagFilterClear");
  const openBtn = document.getElementById("tagFilterBtn");
  const badgeEl = document.getElementById("tagFilterCount");

  const colWrap = document.getElementById("tagFilterColumns");
  const locArea = document.getElementById("tagFilterLocArea");

  // tree structures
  const nodesById = new Map(); // id -> {id,label,depth}
  const children = new Map(); // id -> Set<childId>
  const label = new Map(); // id -> label
  const parent = new Map(); // id -> parentId
  const depthById = new Map(); // id -> depth (1..)
  const pathById = new Map(); // id -> ancestors array (ids)

  // root pseudo id
  const ROOT_ID = "__root__";
  const EMPTY_ID = "__empty__";

  // selection state
  let selected = new Set(); // Set<nodeId>
  let path = []; // currently opened path (ids per depth)
  const MAX_DEPTH = 3;

  // 自動適用（リロード時に earth 側へ再送）
  let hadSavedSelection = false;
  let treeReady = false;
  let earthReady = false;
  let autoApplied = false;

  // iframe の load が tagfilter.js 読み込みより先に発火していると、
  // earth.html 側の dd-earth-ready が受け取れず、自動再適用が走らないことがある。
  // そのため「iframeが読み込まれている」こと自体でも earthReady を立てる。
  function tryMarkEarthReadyByIframeLoad() {
    const iframe = document.getElementById("webxr-iframe");
    if (!iframe) return;

    // load event
    iframe.addEventListener("load", () => {
      earthReady = true;
      scheduleAutoApplyIfNeeded();
    });

    // already loaded?
    try {
      if (iframe.contentDocument && iframe.contentDocument.readyState === "complete") {
        earthReady = true;
        scheduleAutoApplyIfNeeded();
      }
    } catch (e) {
      // cross-origin の可能性があるが、通常は同一オリジン
    }
  }

  // ----------------------------
  //  CSV loader helpers
  // ----------------------------
  async function fetchCSV(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("Failed fetch: " + url + " (" + res.status + ")");
    const text = await res.text();
    return parseCSV(text);
  }

  function parseCSV(text) {
    // minimal CSV parser (handles quotes)
    const rows = [];
    let row = [];
    let cur = "";
    let inQ = false;

    for (let i = 0; i < text.length; i++) {
      const ch = text[i];

      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
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
          row.push(cur);
          cur = "";
        } else if (ch === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
        } else if (ch === "\r") {
          // ignore
        } else {
          cur += ch;
        }
      }
    }
    // last
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  // ----------------------------
  //  Build tree from tree.csv
  // ----------------------------
  function ensureChild(parentId, childId) {
    if (!children.has(parentId)) children.set(parentId, new Set());
    children.get(parentId).add(childId);
  }

  function makeNodeId(depth, text, parentId) {
    // stable id by depth/parent/text
    const base = String(text || "").trim();
    if (!base) return null;
    return depth + "::" + parentId + "::" + base;
  }

  function buildTree(rows) {
    // expect header: L1, L2, L3 (or similar)
    // we treat columns 0..2 as depth 1..3
    nodesById.clear();
    children.clear();
    label.clear();
    parent.clear();
    depthById.clear();
    pathById.clear();

    nodesById.set(ROOT_ID, { id: ROOT_ID, label: "ROOT", depth: 0 });
    label.set(ROOT_ID, "ROOT");
    depthById.set(ROOT_ID, 0);

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r] || [];
      const l1 = (cols[0] || "").trim();
      const l2 = (cols[1] || "").trim();
      const l3 = (cols[2] || "").trim();

      let p = ROOT_ID;

      if (l1) {
        const id1 = makeNodeId(1, l1, ROOT_ID);
        if (!nodesById.has(id1)) {
          nodesById.set(id1, { id: id1, label: l1, depth: 1 });
          label.set(id1, l1);
          parent.set(id1, ROOT_ID);
          depthById.set(id1, 1);
          ensureChild(ROOT_ID, id1);
        }
        p = id1;
      }

      if (l2) {
        const id2 = makeNodeId(2, l2, p);
        if (!nodesById.has(id2)) {
          nodesById.set(id2, { id: id2, label: l2, depth: 2 });
          label.set(id2, l2);
          parent.set(id2, p);
          depthById.set(id2, 2);
          ensureChild(p, id2);
        }
        p = id2;
      }

      if (l3) {
        const id3 = makeNodeId(3, l3, p);
        if (!nodesById.has(id3)) {
          nodesById.set(id3, { id: id3, label: l3, depth: 3 });
          label.set(id3, l3);
          parent.set(id3, p);
          depthById.set(id3, 3);
          ensureChild(p, id3);
        }
        p = id3;
      }
    }

    // build pathById
    nodesById.forEach((node) => {
      if (!node || !node.id) return;
      const arr = [];
      let cur = node.id;
      while (cur && cur !== ROOT_ID) {
        const p = parent.get(cur);
        if (!p) break;
        arr.push(p);
        cur = p;
      }
      // ancestors from root outward
      arr.reverse();
      pathById.set(node.id, arr);
    });
  }

  function getChildren(id) {
    return Array.from(children.get(id) || []);
  }

  function nodeHasChildren(id) {
    const set = children.get(id);
    return set && set.size > 0;
  }

  // ----------------------------
  //  Selection logic
  // ----------------------------
  function setNodeAndDescendants(id, on) {
    if (!id || id === ROOT_ID) return;

    if (on) selected.add(id);
    else selected.delete(id);

    const kids = getChildren(id);
    kids.forEach((kid) => setNodeAndDescendants(kid, on));
  }

  function anySelected() {
    return selected && selected.size > 0;
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_TREE);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          selected = new Set(arr);
          hadSavedSelection = arr.length > 0;
        }
      }
    } catch (e) {}
  }

  function saveSelection() {
    try {
      localStorage.setItem(STORAGE_KEY_TREE, JSON.stringify(Array.from(selected)));
      localStorage.setItem(STORAGE_KEY_APPLIED_MODE, anySelected() ? MODE_TREE : MODE_NONE);
    } catch (e) {}
  }

  function setBadge() {

    if (!badgeEl) return;
    const n = selected.size;
    badgeEl.textContent = "(" + n + ")";
  }

  // ----------------------------
  //  Indeterminate states
  // ----------------------------
  function computeIndeterminateStates() {
    const checked = new Set(selected);
    const indeterminate = new Set();

    // post-order traversal: compute each node if partially selected
    // We'll compute for all nodes by depth descending.
    const nodes = Array.from(nodesById.values()).filter((n) => n.id !== ROOT_ID);
    nodes.sort((a, b) => b.depth - a.depth);

    nodes.forEach((node) => {
      const kids = getChildren(node.id);
      if (!kids.length) return;

      let anyOn = false;
      let anyOff = false;

      kids.forEach((kid) => {
        if (checked.has(kid) || indeterminate.has(kid)) anyOn = true;
        else anyOff = true;
      });

      if (anyOn && anyOff) indeterminate.add(node.id);
      // if all kids on, parent becomes checked too (visual)
      if (anyOn && !anyOff) checked.add(node.id);
    });

    return { checked, indeterminate };
  }

  // ----------------------------
  //  Render
  // ----------------------------
  function clearColumns() {
    if (colWrap) colWrap.innerHTML = "";
  }

  function createColumn(titleText) {
    const col = document.createElement("div");
    col.className = "column";

    const h = document.createElement("h3");
    h.textContent = titleText || " ";
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

      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        const on = cb.checked;
        setNodeAndDescendants(node.id, on);

        // ★ チェック操作でも「開いているパス」を更新する
        //   （例: 1カラム目で別カテゴリにチェックを入れたら、2カラム目もそのカテゴリに切り替える）
        if (node.depth <= 2) {
          const depthIdx = node.depth - 1;
          path = path.slice(0, depthIdx);
          path[depthIdx] = node.id;
          if (!hasKids) {
            path = path.slice(0, depthIdx + 1);
          }
        }

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
    const showL1 = l1 && nodeHasChildren(l1); // ★ 1カラム目が終端(子なし)なら2カラム目のタイトルに出さない
    const col2 = createColumn(showL1 ? label.get(l1) || " " : " ");
    renderList(col2, showL1 ? l1 : null, 2, checked, indeterminate);
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
      clearBtn.disabled = !anySelected() && locSelected.size === 0;
      clearBtn.setAttribute("aria-hidden", "false");
      clearBtn.tabIndex = 0;
    }
  }

  // ----------------------------
  //  location.csv (G/H) 追加カテゴリ
  // ----------------------------
  // 第2カテゴリ：G=親 / H=子
  // 選択状態は locSelected(Set<string>) で保持
  let locReady = false;
  let locSelected = new Set(); // ids: loc::g::... / loc::h::...
  let locParents = new Set(); // Set<G>
  let locChildren = new Map(); // G -> Set<H>
  let locOpenG = null; // 現在開いている G

  function loadLocSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_LOC);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) locSelected = new Set(arr);
      }
    } catch (e) {}
  }

  function saveLocSelection() {
    try {
      localStorage.setItem(STORAGE_KEY_LOC, JSON.stringify(Array.from(locSelected)));
      localStorage.setItem(
        STORAGE_KEY_APPLIED_MODE,
        anySelected() || locSelected.size ? MODE_TREE : MODE_NONE
      );
    } catch (e) {}
  }

  function parseLocationForGH(rows) {
    // location.csv: header expects ... G/H as 7th/8th columns (index 6/7)
    // A:titleJp B:lat C:lng D:url E:status F:(unused) G:TagG H:TagH I.. etc
    locParents.clear();
    locChildren.clear();

    if (!rows || rows.length < 2) return;

    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r] || [];
      const g = (cols[6] || "").trim();
      const h = (cols[7] || "").trim();

      if (!g) continue;

      locParents.add(g);

      if (!locChildren.has(g)) locChildren.set(g, new Set());
      if (h) locChildren.get(g).add(h);
    }
  }

  function makeLocUI() {
    if (!locArea) return;

    locArea.innerHTML = "";

    // "追加カテゴリ（第2）" のみ表示する（第1は表示しない）
    const title = document.createElement("div");
    title.style.fontWeight = "700";
    title.style.fontSize = "14px";
    title.style.margin = "10px 0 6px";
    title.textContent = "追加カテゴリ（第2）";
    locArea.appendChild(title);

    if (!locReady) {
      const msg = document.createElement("div");
      msg.style.padding = "6px 0 12px";
      msg.style.opacity = "0.75";
      msg.textContent = "読み込み中…";
      locArea.appendChild(msg);
      return;
    }

    // 2カラムのリスト領域
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.gap = "14px";
    wrap.style.marginTop = "6px";
    wrap.style.alignItems = "stretch";

    // left = G list
    const left = document.createElement("div");
    left.style.flex = "0 0 260px";
    left.style.width = "260px";
    left.style.border = "1px solid rgba(0,0,0,0.08)";
    left.style.borderRadius = "12px";
    left.style.padding = "10px";
    left.style.background = "rgba(255,255,255,0.96)";
    left.style.overflow = "auto";

    // right = H list
    const right = document.createElement("div");
    right.style.flex = "0 0 260px";
    right.style.width = "260px";
    right.style.border = "1px solid rgba(0,0,0,0.08)";
    right.style.borderRadius = "12px";
    right.style.padding = "10px";
    right.style.background = "rgba(255,255,255,0.96)";
    right.style.overflow = "auto";

    wrap.appendChild(left);
    wrap.appendChild(right);
    locArea.appendChild(wrap);

    // render left parents
    const gs = Array.from(locParents);
    gs.sort((a, b) => a.localeCompare(b, "ja"));

    gs.forEach((g) => {
      const id = "loc::g::" + g;
      const row = makeLocRow(id, g, true);
      // active highlight
      if (locOpenG === g) row.style.background = "rgba(50,112,166,0.10)";

      row.addEventListener("click", () => {
        locOpenG = g;
        makeLocUI();
      });
      left.appendChild(row);
    });

    // render right children for selected G
    if (!locOpenG) locOpenG = gs[0] || null;

    const hs = Array.from(locChildren.get(locOpenG) || []);
    hs.sort((a, b) => a.localeCompare(b, "ja"));
    hs.forEach((h) => {
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
    cb.checked = locSelected.has(id);

    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = text || "";

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

        if (on) locSelected.add(id);
        else locSelected.delete(id);

        const kids = locChildren.get(g) || new Set();
        kids.forEach((h) => {
          const hid = "loc::h::" + g + "::" + h;
          if (on) locSelected.add(hid);
          else locSelected.delete(hid);
        });
      } else {
        // H の単独ON/OFF
        if (on) locSelected.add(id);
        else locSelected.delete(id);
      }

      saveLocSelection();
      setBadge();
      renderColumns(); // tree側の UI もインディターミネート状態が変わる可能性があるので再描画
      makeLocUI();

      // ★ applyBtn が無い構成なら「自動適用」
      schedulePostSelected();
    });

    return row;
  }

  // ----------------------------
  //  Posting selected tags to earth iframe
  // ----------------------------
  let postTimer = null;

  function getSelectedPayload() {
    // tree selected labels
    const treeLabels = Array.from(selected)
      .map((id) => label.get(id))
      .filter(Boolean);

    // loc selected labels: for h we store only H text; for g we store G text
    const locLabels = Array.from(locSelected)
      .map((id) => {
        // loc::g::G
        if (id.startsWith("loc::g::")) {
          return id.replace("loc::g::", "");
        }
        // loc::h::G::H
        if (id.startsWith("loc::h::")) {
          const parts = id.split("::");
          // ["loc", "h", "G", "H..."]
          return parts.slice(3).join("::");
        }
        return null;
      })
      .filter(Boolean);

    return {
      mode: anySelected() || locSelected.size ? MODE_TREE : MODE_NONE,
      tree: treeLabels,
      loc: locLabels,
    };
  }

  function postSelectedToEarth() {
    const iframe = document.getElementById("webxr-iframe");
    if (!iframe || !iframe.contentWindow) return;

    const payload = getSelectedPayload();
    iframe.contentWindow.postMessage({ type: "dd-tags-apply", tags: payload }, "*");
  }

  function schedulePostSelected() {
    // applyBtn がある場合は、基本は手動適用
    // ただし applyBtn が無い UI 構成では、操作の度に適用
    if (applyBtn) return;

    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      postSelectedToEarth();
    }, 150);
  }

  function scheduleAutoApplyIfNeeded() {
    // 1) saved selection exists
    // 2) earth ready
    // 3) not already auto-applied
    if (autoApplied) return;
    if (!hadSavedSelection && locSelected.size === 0) return;
    if (!earthReady) return;

    autoApplied = true;
    // micro delay
    setTimeout(() => {
      postSelectedToEarth();
    }, 250);
  }

  // listen for earth ready
  window.addEventListener("message", (ev) => {
    if (!ev || !ev.data) return;
    if (ev.data.type === "dd-earth-ready") {
      earthReady = true;
      scheduleAutoApplyIfNeeded();
    }
  });

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal() {
    if (!backdrop) return;
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    if (!backdrop) return;
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
  }

  if (openBtn) openBtn.addEventListener("click", openModal);
  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (backdrop)
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) closeModal();
    });

  // apply / clear
  if (applyBtn)
    applyBtn.addEventListener("click", () => {
      postSelectedToEarth();
      closeModal();
    });

  if (clearBtn)
    clearBtn.addEventListener("click", () => {
      // clear both
      selected = new Set();
      locSelected = new Set();
      path = [];
      saveSelection();
      saveLocSelection();
      setBadge();
      renderColumns();
      makeLocUI();

      // auto apply when clear
      postSelectedToEarth();
    });

  // ----------------------------
  //  Boot
  // ----------------------------
  async function boot() {
    if (!colWrap) return;

    loadSelection();
    loadLocSelection();
    setBadge();

    tryMarkEarthReadyByIframeLoad();

    // load tree
    try {
      const rows = await fetchCSV(TREE_CSV_URL);
      buildTree(rows);
      treeReady = true;
      renderColumns();
    } catch (e) {
      treeReady = false;
      clearColumns();
      const msg = document.createElement("div");
      msg.style.padding = "10px";
      msg.style.color = "crimson";
      msg.textContent = "tree.csv の読み込みに失敗しました: " + e.message;
      colWrap.appendChild(msg);
    }

    // load location
    try {
      const rows2 = await fetchCSV(LOCATION_CSV_URL);
      parseLocationForGH(rows2);
      locReady = true;
      makeLocUI();
    } catch (e) {
      locReady = false;
      if (locArea) {
        locArea.innerHTML = "";
        const title = document.createElement("div");
        title.style.fontWeight = "700";
        title.style.fontSize = "14px";
        title.style.margin = "10px 0 6px";
        title.textContent = "追加カテゴリ（第2）";
        locArea.appendChild(title);

        const msg = document.createElement("div");
        msg.style.padding = "6px 0 12px";
        msg.style.color = "crimson";
        msg.textContent =
          "location.csv の列数が想定より少ないため、G/H を読み取れません（公開CSVに G/H が含まれているか確認してください）";
        locArea.appendChild(msg);
      }
    }

    // auto apply if possible
    scheduleAutoApplyIfNeeded();
  }

  // ensure DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
