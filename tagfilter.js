(function () {
  // =========================================================
  //  Tag Filter Modal (tree.csv)  +  location.csv(G/H) extra categories
  //
  //  既存の tree.csv 3カラム絞り込みを絶対に壊さない方針で、
  //  location.csv の G/H を「擬似ノード」として tree UI に統合する。
  //
  //  期待動作:
  //   - 第1カラム: tree(既存)の直下に、location の G を同じ体裁で並べる
  //   - Gをクリック: 第2カラムに H を並べる
  //   - 適用/クリア/保存/既存postMessage系はそのまま
  // =========================================================

  const STORAGE_KEY = "dd_filter_tree_selected_v1";

  // tree.csv (Google Sheets publish csv)
  const TREE_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";
  const TREE_URL_FALLBACK = "./tree.csv";

  // location.csv (Google Sheets publish csv)
  const LOCATION_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=717261533&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

  // location.csv columns (0-based): G=6, H=7
  const LOC_G_INDEX = 6;
  const LOC_H_INDEX = 7;

  const ROOT_ID = "__root__";

  // ---------------------------------------------------------
  //  DOM
  // ---------------------------------------------------------
  const modal = document.getElementById("tagFilterModal");
  const btnOpen = document.getElementById("tagFilterOpen");
  const btnClose = document.getElementById("tagFilterClose");
  const btnApply = document.getElementById("tagFilterApply");
  const btnClear = document.getElementById("tagFilterClear");

  const colWrap = document.getElementById("tagFilterColumns");
  const badge = document.getElementById("tagFilterBadge");

  // 旧「追加カテゴリ専用UI」の領域（今後は使わない。空白のズレ防止のため隠す）
  const locArea = document.getElementById("tagFilterLocArea");
  if (locArea) locArea.style.display = "none"; // 追加カテゴリは tree UI に統合するため、この領域は使わない

  // ---------------------------------------------------------
  //  State
  // ---------------------------------------------------------
  const selected = new Set(); // id set

  const nodesById = new Map();     // id -> { id }
  const label = new Map();         // id -> label text
  const parent = new Map();        // id -> parent id
  const depthById = new Map();     // id -> depth (root children = 1)
  const childrenByParent = new Map(); // parent id -> Set(child ids)
  const pathById = new Map();      // id -> [ancestor ids..., id]

  let treeReady = false;

  // path for 3 columns (clicked chain)
  // e.g. [idLevel1, idLevel2]
  let path = [];

  // location parsed cache
  let locGList = [];
  let locChildren = new Map(); // g -> Set(h)
  let locReady = false;

  // ---------------------------------------------------------
  //  Utils
  // ---------------------------------------------------------
  function ensureSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  function normalizeText(s) {
    return (s || "").trim();
  }

  function loadSelected() {
    selected.clear();
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        arr.forEach((id) => {
          if (typeof id === "string") selected.add(id);
        });
      }
    } catch (e) {}
  }

  function saveSelected() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selected)));
    } catch (e) {}
  }

  function updateBadge() {
    if (!badge) return;
    const n = selected.size;
    if (n <= 0) {
      badge.textContent = "";
      badge.style.display = "none";
    } else {
      badge.textContent = String(n);
      badge.style.display = "";
    }
  }

  function openModal() {
    if (!modal) return;
    modal.style.display = "block";
  }

  function closeModal() {
    if (!modal) return;
    modal.style.display = "none";
  }


  function clearSelection() {
    selected.clear();
    saveSelected();
    updateBadge();
    renderColumns();
  }

  function fetchCsv(url) {
    return fetch(url, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("fetch failed: " + r.status);
      return r.text();
    });
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

  // ---------------------------------------------------------
  //  Build tree from tree.csv
  // ---------------------------------------------------------
  function resetTree() {
    nodesById.clear();
    label.clear();
    parent.clear();
    depthById.clear();
    childrenByParent.clear();
    pathById.clear();

    nodesById.set(ROOT_ID, { id: ROOT_ID });
    label.set(ROOT_ID, "");
    parent.set(ROOT_ID, "");
    depthById.set(ROOT_ID, 0);
    ensureSet(childrenByParent, ROOT_ID);
    pathById.set(ROOT_ID, []);
  }

  function makeId(parts) {
    // parts: [l1,l2,l3,...]
    return parts.map((s) => s.replace(/\s+/g, " ").trim()).join(" / ");
  }

  function addNodeChain(chain) {
    // chain: array of labels
    let p = ROOT_ID;
    let curPath = [];
    for (let d = 0; d < chain.length; d++) {
      const t = normalizeText(chain[d]);
      if (!t) break;
      curPath = curPath.concat([]); // copy
      curPath.push(t);

      const id = makeId(curPath);

      if (!nodesById.has(id)) {
        nodesById.set(id, { id });
        label.set(id, t);
        parent.set(id, p);
        depthById.set(id, d + 1);

        ensureSet(childrenByParent, p).add(id);
        ensureSet(childrenByParent, id);

        pathById.set(id, curPath.slice(0, d).map((_, idx) => makeId(curPath.slice(0, idx + 1))).concat([id]));
      }
      p = id;
    }
  }

  function buildTreeFromCsv(csv) {
    resetTree();

    const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length <= 0) return;

    // if header line exists, it may be like "L1,L2,L3,..."
    let start = 0;
    const head = csvParseLine(lines[0]).map(normalizeText);
    if (head.some((h) => /^l\d+$/i.test(h))) start = 1;

    for (let i = start; i < lines.length; i++) {
      const parts = csvParseLine(lines[i]).map(normalizeText);
      // remove empty tail
      while (parts.length > 0 && !parts[parts.length - 1]) parts.pop();
      if (parts.length === 0) continue;
      addNodeChain(parts);
    }
  }

  // ---------------------------------------------------------
  //  Parse location.csv (G/H)
  // ---------------------------------------------------------
  async function loadLocationCats() {
    locReady = false;
    locGList = [];
    locChildren = new Map();

    let csv = "";
    try {
      csv = await fetchCsv(LOCATION_URL_PRIMARY);
    } catch (e) {
      try {
        csv = await fetchCsv(LOCATION_URL_FALLBACK);
      } catch (e2) {
        locReady = false;
        injectLocationNodes();
        return;
      }
    }

    try {
      const lines = csv.split(/\r?\n/).filter((l) => l.trim() !== "");
      if (lines.length <= 0) {
        locReady = true;
        injectLocationNodes();
        return;
      }

      // optional header: titleJp,lat,lng,url,...
      let start = 0;
      const head = csvParseLine(lines[0]).map(normalizeText);
      if (head.length >= 4 && /title/i.test(head[0] || "")) start = 1;

      const gSet = new Set();

      for (let i = start; i < lines.length; i++) {
        const parts = csvParseLine(lines[i]);
        const g = normalizeText(parts[LOC_G_INDEX]);
        const h = normalizeText(parts[LOC_H_INDEX]);

        if (!g) continue;

        gSet.add(g);
        if (h) {
          ensureSet(locChildren, g).add(h);
        } else {
          ensureSet(locChildren, g); // empty setでも作る
        }
      }

      locGList = Array.from(gSet).sort((a, b) => a.localeCompare(b, "ja"));

      // H側もソートしておく
      for (const [g, set] of locChildren.entries()) {
        const arr = Array.from(set).sort((a, b) => a.localeCompare(b, "ja"));
        locChildren.set(g, new Set(arr));
      }

      locReady = true;
      injectLocationNodes();
    } catch (e) {
      locReady = false;
      injectLocationNodes();
    }
  }

  // ---------------------------------------------------------
  //  location(G/H) を tree UI に統合（擬似ノード注入）
  // ---------------------------------------------------------

  // 追加カテゴリ（location.csv の G/H）を、既存の tree 構造に「擬似ノード」として注入する。
  // - 第1カテゴリ(G) : depth=1 / parent=ROOT_ID
  // - 第2カテゴリ(H) : depth=2 / parent=loc::g::<G>
  //
  // これにより、既存の 3カラムUI (renderColumns/renderList) をそのまま使って
  // 「Gを第1カラムに表示 → クリックで第2カラムにHを表示」を実現する。
  const _locInjectedIds = new Set();

  function injectLocationNodes() {
    // index.html側が未対応／取得失敗／データ無し なら何もしない（既存機能を壊さない）
    if (!locReady || !locGList || locGList.length === 0) {
      // 以前注入していた場合だけ掃除
      if (_locInjectedIds.size > 0) {
        removeInjectedLocNodes();
        renderColumns();
      }
      return;
    }

    // いったん掃除してから入れ直す（再読込・再実行でも重複しない）
    if (_locInjectedIds.size > 0) removeInjectedLocNodes();

    // ROOT の子セットを用意
    ensureSet(childrenByParent, ROOT_ID);

    // G → H の順に追加（ROOT直下の末尾に追加される＝「□文化」の下に並ぶ想定）
    locGList.forEach((g) => {
      const gId = "loc::g::" + g;

      label.set(gId, g);
      parent.set(gId, ROOT_ID);
      depthById.set(gId, 1);

      ensureSet(childrenByParent, ROOT_ID).add(gId);
      ensureSet(childrenByParent, gId);

      _locInjectedIds.add(gId);

      const hs = locChildren && locChildren.get(g) ? Array.from(locChildren.get(g)) : [];
      hs.sort((a, b) => a.localeCompare(b, "ja")).forEach((h) => {
        const hId = "loc::h::" + g + "::" + h;

        label.set(hId, h);
        parent.set(hId, gId);
        depthById.set(hId, 2);

        ensureSet(childrenByParent, gId).add(hId);
        _locInjectedIds.add(hId);
      });
    });

    // pathが空なら、locの先頭を開く（tree側を触らない）
    if (!Array.isArray(path) || path.length === 0) {
      const firstG = locGList[0];
      if (firstG) path = ["loc::g::" + firstG];
    }

    renderColumns();
  }

  function removeInjectedLocNodes() {
    // ROOTの子からlocのGを外す
    const rootSet = childrenByParent.get(ROOT_ID);
    if (rootSet) {
      Array.from(rootSet).forEach((id) => {
        if (_locInjectedIds.has(id)) rootSet.delete(id);
      });
    }

    // map掃除 + 選択掃除
    _locInjectedIds.forEach((id) => {
      childrenByParent.delete(id);
      nodesById.delete(id);
      label.delete(id);
      parent.delete(id);
      depthById.delete(id);
      pathById.delete(id);
      if (selected.has(id)) selected.delete(id);
    });

    // path に loc が残っていたら除去（落ちるの防止）
    if (Array.isArray(path) && path.length) {
      const ids = new Set(Array.from(_locInjectedIds));
      path = path.filter((id) => !ids.has(id));
    }

    _locInjectedIds.clear();
  }

  // ---------------------------------------------------------
  //  Render (3 columns)
  // ---------------------------------------------------------
  function clearColumns() {
    if (!colWrap) return;
    colWrap.innerHTML = "";

    const c1 = document.createElement("div");
    c1.className = "col";
    c1.id = "tagFilterCol1";

    const c2 = document.createElement("div");
    c2.className = "col";
    c2.id = "tagFilterCol2";

    const c3 = document.createElement("div");
    c3.className = "col";
    c3.id = "tagFilterCol3";

    colWrap.appendChild(c1);
    colWrap.appendChild(c2);
    colWrap.appendChild(c3);
  }

  function computeIndeterminateStates() {
    // for parent checkboxes in tree-like selection
    const ind = new Set();

    function dfs(id) {
      const kids = childrenByParent.get(id);
      if (!kids || kids.size === 0) {
        return selected.has(id) ? 1 : 0;
      }
      let on = 0;
      let off = 0;
      kids.forEach((k) => {
        const st = dfs(k);
        if (st === 1) on++;
        else if (st === 0) off++;
        else {
          on++;
          off++;
        }
      });
      if (on > 0 && off > 0) {
        ind.add(id);
        return -1;
      }
      if (on > 0) return 1;
      return 0;
    }

    dfs(ROOT_ID);
    return ind;
  }

  function renderList(container, parentId, depth, colIndex, indSet) {
    container.innerHTML = "";

    const kids = childrenByParent.get(parentId);
    if (!kids || kids.size === 0) return;

    Array.from(kids).forEach((id) => {
      const row = document.createElement("div");
      row.className = "node";

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = selected.has(id);
      cb.indeterminate = indSet.has(id);

      const lab = document.createElement("div");
      lab.className = "label";
      lab.textContent = label.get(id) || "";

      const chev = document.createElement("div");
      chev.className = "chev";
      // has children -> show >
      const hasChild = (childrenByParent.get(id) || new Set()).size > 0;
      chev.textContent = hasChild ? "›" : "";

      row.appendChild(cb);
      row.appendChild(lab);
      row.appendChild(chev);

      // checkbox toggle
      cb.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleId(id, cb.checked);
        saveSelected();
        updateBadge();
        renderColumns();
      });

      // row click: open next column if child exists
      row.addEventListener("click", () => {
        const hasChild2 = (childrenByParent.get(id) || new Set()).size > 0;
        if (!hasChild2) return;

        // update path at current depth (colIndex)
        // col1 -> path[0], col2 -> path[1]
        const p2 = path.slice(0, colIndex - 1);
        p2.push(id);
        path = p2;

        renderColumns();
      });

      container.appendChild(row);
    });
  }

  function toggleId(id, on) {
    if (on) selected.add(id);
    else selected.delete(id);
  }

  function renderColumns() {
    if (!treeReady) return;

    clearColumns();

    const c1 = document.getElementById("tagFilterCol1");
    const c2 = document.getElementById("tagFilterCol2");
    const c3 = document.getElementById("tagFilterCol3");

    const ind = computeIndeterminateStates();

    // col1: root children
    renderList(c1, ROOT_ID, 1, 1, ind);

    // col2
    const id1 = path[0];
    if (id1) renderList(c2, id1, 2, 2, ind);

    // col3
    const id2 = path[1];
    if (id2) renderList(c3, id2, 3, 3, ind);

    updateBadge();
  }

  // ---------------------------------------------------------
  //  Apply (postMessage)
  // ---------------------------------------------------------
  function applyToEarth() {
    // 既存のpostMessage仕様を維持する
    // - earth.html 側は "dd:filter" を受け取り、selectedIds を使う想定
    const iframe = document.getElementById("earthFrame");
    if (!iframe || !iframe.contentWindow) return;

    iframe.contentWindow.postMessage(
      {
        type: "dd:filter",
        selectedIds: Array.from(selected),
      },
      "*"
    );
  }

  function tryAutoApply() {
    // 初回表示やリロード時の反映（既存仕様を尊重）
    applyToEarth();
  }

  // ---------------------------------------------------------
  //  Init
  // ---------------------------------------------------------
  async function init() {
    loadSelected();
    updateBadge();

    if (btnOpen) btnOpen.addEventListener("click", openModal);
    if (btnClose) btnClose.addEventListener("click", closeModal);

    if (btnClear) {
      btnClear.addEventListener("click", () => {
        clearSelection();
      });
    }

    if (btnApply) {
      btnApply.addEventListener("click", () => {
        saveSelected();
        applyToEarth();
        closeModal();
      });
    }

    // click outside
    window.addEventListener("click", (e) => {
      if (!modal) return;
      if (e.target === modal) closeModal();
    });

    // load tree and render
    try {
      const csv = await fetchCsv(TREE_URL_PRIMARY);
      buildTreeFromCsv(csv);
      treeReady = true;
      await loadLocationCats();
      renderColumns();
      tryAutoApply();
      return;
    } catch (e) {}

    try {
      const csv = await fetchCsv(TREE_URL_FALLBACK);
      buildTreeFromCsv(csv);
      treeReady = true;
      await loadLocationCats();
      renderColumns();
      tryAutoApply();
      return;
    } catch (e2) {}

    // failed
    treeReady = false;
  }

  init();

  // ---------------------------------------------------------
  //  (旧実装の名残) 使わないが、他箇所参照があっても壊れないように残す
  // ---------------------------------------------------------
  function makeLocRow(id, text, isG) {
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
      toggleId(id, on);
      saveSelected();
      updateBadge();
      renderColumns();
    });

    return row;
  }
})();
