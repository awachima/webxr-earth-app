(function () {
  // ----------------------------
  //  Tag Filter (tree.csv) + location.csv(G/H) 追加カテゴリ
  // ----------------------------

  const STORAGE_KEY = "dd_filter_tree_selected_v1";

  // tree.csv（絞り込み用）URL（Google Sheets publish CSV）
  const TREE_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";

  // tree.csv フォールバック（同梱tree.csvがある場合）
  const TREE_URL_FALLBACK = "./tree.csv";

  // location.csv（追加カテゴリ用：G/H）URL（Google Sheets publish CSV）
  // マスターが提示してくれた gid=717261533 の CSV
  const LOCATION_URL =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=717261533&single=true&output=csv";

  // モーダル要素
  const filterBtn = document.getElementById("filterBtn");
  const modal = document.getElementById("tagFilterModal");
  const modalClose = document.getElementById("tagFilterClose");
  const modalClear = document.getElementById("tagFilterClear");
  const modalApply = document.getElementById("tagFilterApply");

  // カラム要素（既存：絞り込みツリー）
  const col1 = document.getElementById("tagFilterCol1");
  const col2 = document.getElementById("tagFilterCol2");
  const col3 = document.getElementById("tagFilterCol3");

  // 追加カテゴリ領域（G/H）
  const locArea = document.getElementById("tagFilterLocArea");

  // 選択中
  let selected = new Set();

  // treeノード構造
  const ROOT_ID = "__ROOT__";
  const EMPTY_ID = "__EMPTY__";

  // ノード情報
  // id -> { id, label, parentId, level }
  const nodes = new Map();
  // parentId -> Set(childId)
  const childrenByParent = new Map();

  // id -> label
  const label = new Map();

  // UI状態
  let openL1 = null;
  let openL2 = null;

  // earth iframe
  const iframe = document.getElementById("earthFrame");
  let earthReady = false;
  let autoApplied = false;

  // 追加カテゴリ (location.csv G/H)
  let locReady = false;
  let locGList = [];
  let locChildren = new Map(); // G -> Set(H)
  let locOpenG = null; // 現在右に出す G
  let locDebugMessage = "";

  // ----------------------------
  //  Helpers
  // ----------------------------
  function ensureSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  function csvParseLine(line) {
    // 簡易CSVパーサ（ダブルクオート対応）
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

  function safeFetchText(url) {
    return fetch(url, { cache: "no-store" }).then((r) => {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.text();
    });
  }

  // ----------------------------
  //  Build tree from CSV (max 3 columns)
  // ----------------------------
  function addNode(id, text, parentId, level) {
    if (!nodes.has(id)) {
      nodes.set(id, { id, label: text, parentId, level });
      label.set(id, text);
    }
    ensureSet(childrenByParent, parentId).add(id);
  }

  function getNodeId(level, text, p1, p2) {
    // 安定ID（ラベルを含む）
    if (level === 1) return "l1::" + text;
    if (level === 2) return "l2::" + p1 + "::" + text;
    return "l3::" + p1 + "::" + p2 + "::" + text;
  }

  function normalizeText(s) {
    return String(s || "")
      .replace(/\u00A0/g, " ")
      .trim();
  }

  function loadTree() {
    safeFetchText(TREE_URL)
      .catch(() => safeFetchText(TREE_URL_FALLBACK))
      .then((text) => {
        buildTree(text);
        renderColumns();
        tryAutoApply();
      })
      .catch((e) => {
        console.warn("tree load failed", e);
        // ツリーが読めなくても、追加カテゴリは動かす
        buildTree("");
        renderColumns();
      });

    // location(G/H) 追加カテゴリもロード
    loadLocationGH();
  }

  function buildTree(csvText) {
    nodes.clear();
    childrenByParent.clear();
    label.clear();

    // ルート
    nodes.set(ROOT_ID, { id: ROOT_ID, label: "ROOT", parentId: null, level: 0 });
    label.set(ROOT_ID, "ROOT");

    if (!csvText) {
      // 空でもUIは成立させる
      openL1 = null;
      openL2 = null;
      return;
    }

    const lines = csvText.trim().split(/\r?\n/);
    if (!lines.length) return;

    // ヘッダの可能性があるので1行目を見て判断
    let start = 0;
    try {
      const head = csvParseLine(lines[0]);
      const a = normalizeText(head[0]);
      const b = normalizeText(head[1]);
      const c = normalizeText(head[2]);
      // 「カテゴリ」等が入ってそうならヘッダ扱い
      if (a && (a.includes("カテゴリ") || a.toLowerCase() === "l1" || a.toLowerCase() === "level1")) {
        start = 1;
      }
      // もし1行目が空に近いならデータ
      if (!a && !b && !c) start = 1;
    } catch (_) {}

    const l1Set = new Set();

    for (let i = start; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]);
      const L1 = normalizeText(cols[0]);
      const L2 = normalizeText(cols[1]);
      const L3 = normalizeText(cols[2]);

      if (!L1) continue;

      l1Set.add(L1);

      const id1 = getNodeId(1, L1);
      addNode(id1, L1, ROOT_ID, 1);

      if (L2) {
        const id2 = getNodeId(2, L2, L1);
        addNode(id2, L2, id1, 2);

        if (L3) {
          const id3 = getNodeId(3, L3, L1, L2);
          addNode(id3, L3, id2, 3);
        }
      }
    }

    // 初期オープン
    const l1List = Array.from(l1Set).sort((a, b) => a.localeCompare(b, "ja"));
    openL1 = l1List[0] ? getNodeId(1, l1List[0]) : null;
    openL2 = null;
  }

  // ----------------------------
  //  Render columns (tree)
  // ----------------------------
  function clearCols() {
    if (col1) col1.innerHTML = "";
    if (col2) col2.innerHTML = "";
    if (col3) col3.innerHTML = "";
  }

  function makeNodeRow(nodeId, isLeaf, isActive, isColumnOpenable) {
    const n = nodes.get(nodeId);
    const row = document.createElement("div");
    row.className = "node";
    if (isActive) row.classList.add("active");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(nodeId);

    const lab = document.createElement("span");
    lab.textContent = n ? n.label : nodeId;

    const chev = document.createElement("span");
    chev.className = "chev";
    chev.textContent = isLeaf ? "" : "›";

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    // indeterminate（ツリー側）
    if (cb && cb.type === "checkbox") {
      cb.indeterminate = isIndeterminate(nodeId);
    }

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = cb.checked;
      setNodeAndDescendants(nodeId, on);
      saveSelection();
      setBadge();
      renderColumns(); // チェック状態更新
    });

    row.addEventListener("click", () => {
      if (!isColumnOpenable) return;
      // 列を開く
      if (n.level === 1) {
        openL1 = nodeId;
        openL2 = null;
      } else if (n.level === 2) {
        openL2 = nodeId;
      }
      renderColumns();
    });

    return row;
  }

  function renderColumns() {
    clearCols();

    if (!col1 || !col2 || !col3) return;

    // L1
    const l1Kids = childrenByParent.get(ROOT_ID) || new Set();
    const l1List = Array.from(l1Kids).sort((a, b) =>
      (label.get(a) || "").localeCompare(label.get(b) || "", "ja")
    );

    l1List.forEach((id1) => {
      const hasKids = (childrenByParent.get(id1) || new Set()).size > 0;
      const row = makeNodeRow(id1, !hasKids, openL1 === id1, true);
      col1.appendChild(row);
    });

    // L2
    if (openL1) {
      const l2Kids = childrenByParent.get(openL1) || new Set();
      const l2List = Array.from(l2Kids).sort((a, b) =>
        (label.get(a) || "").localeCompare(label.get(b) || "", "ja")
      );

      l2List.forEach((id2) => {
        const hasKids = (childrenByParent.get(id2) || new Set()).size > 0;
        const row = makeNodeRow(id2, !hasKids, openL2 === id2, hasKids);
        col2.appendChild(row);
      });

      // openL2 が無効なら自動で先頭を開く（子がある場合のみ）
      if (openL2 && !l2Kids.has(openL2)) openL2 = null;
      if (!openL2) {
        const firstWithKids = l2List.find((id2) => (childrenByParent.get(id2) || new Set()).size > 0);
        if (firstWithKids) openL2 = firstWithKids;
      }
    }

    // L3
    if (openL2) {
      const l3Kids = childrenByParent.get(openL2) || new Set();
      const l3List = Array.from(l3Kids).sort((a, b) =>
        (label.get(a) || "").localeCompare(label.get(b) || "", "ja")
      );

      l3List.forEach((id3) => {
        const row = makeNodeRow(id3, true, false, false);
        col3.appendChild(row);
      });
    }

    // 追加カテゴリ描画
    renderLocArea();
  }

  // ----------------------------
  //  Indeterminate (tree)
  // ----------------------------
  let indeterminateCache = new Set();

  function computeIndeterminateStates() {
    // For each node, compute if it should be indeterminate based on descendants selection.
    const checked = new Set();
    const indeterminate = new Set();

    function walk(nodeId) {
      const kids = childrenByParent.get(nodeId);
      if (!kids || kids.size === 0) {
        const isChecked = selected.has(nodeId);
        if (isChecked) checked.add(nodeId);
        return isChecked ? 1 : 0; // 1 checked, 0 not
      }

      let total = 0;
      let checkedCount = 0;
      let anyInd = false;

      kids.forEach((kid) => {
        total++;
        const r = walk(kid);
        if (r === 1) checkedCount++;
        else if (r === 2) anyInd = true;
      });

      const selfChecked = selected.has(nodeId);
      if (selfChecked) {
        checked.add(nodeId);
      }

      // Determine state:
      // - if all children checked and none indeterminate, node is considered checked
      // - if no child checked and none indeterminate, node is unchecked
      // - otherwise indeterminate
      if ((checkedCount === total && !anyInd) || selfChecked) {
        // treat as checked (but we still allow partial selections below)
        if (checkedCount === total && !anyInd && !selfChecked) {
          // parent unchecked but all kids checked -> indeterminate to show partial state
          indeterminate.add(nodeId);
          return 2;
        }
        return 1;
      }

      if (checkedCount === 0 && !anyInd && !selfChecked) return 0;

      indeterminate.add(nodeId);
      return 2;
    }

    // start from ROOT children
    (childrenByParent.get(ROOT_ID) || new Set()).forEach((kid) => walk(kid));

    indeterminateCache = indeterminate;
  }

  function isIndeterminate(nodeId) {
    computeIndeterminateStates();
    return indeterminateCache.has(nodeId);
  }

  function setNodeAndDescendants(nodeId, on) {
    if (on) selected.add(nodeId);
    else selected.delete(nodeId);

    const kids = childrenByParent.get(nodeId);
    if (!kids || kids.size === 0) return;
    kids.forEach((k) => setNodeAndDescendants(k, on));
  }

  // ----------------------------
  //  追加カテゴリ (location.csv G/H) の読み込み
  // ----------------------------
  function loadLocationGH() {
    locReady = false;
    locGList = [];
    locChildren = new Map();
    locOpenG = null;
    locDebugMessage = "";

    safeFetchText(LOCATION_URL)
      .then((text) => buildLocationGH(text))
      .catch((e) => {
        console.warn("location.csv load failed", e);
        locReady = false;
        locDebugMessage = "location.csv の読み込みに失敗しました（公開CSV URL を確認してください）";
        renderLocArea();
      });
  }

  function buildLocationGH(text) {
    if (!text) {
      // 読めない場合でもUI箱は残す（空表示）
      locReady = false;
      locDebugMessage = "location.csv を読み込めませんでした（URL/gid を確認してください）";
      renderLocArea();
      return;
    }

    const lines = text.trim().split(/\r?\n/);
    if (!lines.length) {
      locReady = false;
      locDebugMessage = "location.csv が空です";
      renderLocArea();
      return;
    }

    // 先頭行がヘッダかデータか判定
    // 既存 location.csv は (titleJp, lat, lng, url, ...) の想定
    let start = 0;
    try {
      const head = csvParseLine(lines[0]); // 既存Helperを利用
      const lat = parseFloat((head[1] || "").replace(/[−–‐]/g, "-"));
      const lng = parseFloat((head[2] || "").replace(/[−–‐]/g, "-"));
      if (isNaN(lat) || isNaN(lng)) start = 1;
    } catch (_) {}

    const gSet = new Set();
    const childMap = new Map();

    // 列数不足チェック（最低でもHまで必要）
    // ※ 行によって列数が違うCSVもあり得るので、まずは先頭の列数で雑に判断し、最終的には各行で防御する
    try {
      const firstData = csvParseLine(lines[Math.min(start, lines.length - 1)]);
      if (firstData.length < 8) {
        // A..H => index 0..7
        // 7未満だとHが無い
        locDebugMessage =
          "location.csv の列数が想定より少ないため、G/H を読み取れません（公開CSVに G/H が含まれているか確認してください）";
      }
    } catch (_) {}

    for (let i = start; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]);
      // G/H は index 6/7 （A=0）
      const g = normalizeText(cols[6]);
      const h = normalizeText(cols[7]);

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

    // 読み込み失敗時のメッセージ（左にだけ）
    if (!locReady) {
      const p = document.createElement("div");
      p.style.padding = "8px 4px";
      p.style.fontSize = "12px";
      p.style.color = "#666";
      p.textContent = locDebugMessage || "追加カテゴリを読み込めませんでした。";
      left.appendChild(p);
      locArea.appendChild(left);
      locArea.appendChild(right);
      return;
    }

    // 左: G一覧（第1カテゴリ）
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

    // 追加カテゴリ(G)は、子(H)が一部選択されたときに「ー」(indeterminate) を表示
    if (isG) {
      const g = text;
      const kids = locChildren.get(g) || new Set();
      let selCount = 0;
      kids.forEach((h) => {
        const hid = "loc::h::" + g + "::" + h;
        if (selected.has(hid)) selCount++;
      });
      cb.indeterminate = selCount > 0 && !selected.has(id);
    }

    const lab = document.createElement("span");
    lab.textContent = text;

    const chev = document.createElement("span");
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
    });

    return row;
  }

  // ----------------------------
  //  Badge
  // ----------------------------
  function setBadge() {
    // 既存UIではバッジ非表示方針（CSSで消している想定）
    // ここは残しておく（既存機能破壊防止）
  }

  // ----------------------------
  //  Save/Load
  // ----------------------------
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
          arr
            .map((x) => String(x))
            .filter((id) => id && id !== ROOT_ID && id !== EMPTY_ID)
        );
      }
    } catch (e) {}
  }

  // ----------------------------
  //  Apply to Earth
  // ----------------------------
  function postSelected() {
    // earth側は「タグ名」を期待しているので label を送る
    // 追加カテゴリ(H)だけ選ばれた場合でも地球儀側で拾えるように、親(G)タグも一緒に送る
    const tagSet = new Set();

    Array.from(selected).forEach((id) => {
      const lbl = (label.get(id) || id);
      const s = String(lbl).trim();
      if (s) tagSet.add(s);

      // Hを選んだら、親Gも送る（Gチェックが無くても反映されるように）
      if (String(id).startsWith("loc::h::")) {
        const parts = String(id).split("::"); // ["loc","h", "<G>", "<H>"]
        const g = (parts[2] || "").trim();
        if (g) tagSet.add(g);
      }
    });

    const tags = Array.from(tagSet);

    try {
      iframe.contentWindow.postMessage({ type: "dd-tags-apply", tags }, "*");
    } catch (e) {
      console.warn(e);
    }
  }

  function tryAutoApply() {
    if (autoApplied) return;
    if (!earthReady) return;

    // 起動時に保存済みフィルタがあれば自動適用
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
    if (!modal) return;
    modal.classList.add("open");
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.remove("open");
  }

  if (filterBtn) filterBtn.addEventListener("click", openModal);
  if (modalClose) modalClose.addEventListener("click", closeModal);

  // クリア
  if (modalClear)
    modalClear.addEventListener("click", () => {
      selected.clear();
      saveSelection();
      setBadge();
      renderColumns();
      postSelected();
    });

  // 適用
  if (modalApply)
    modalApply.addEventListener("click", () => {
      postSelected();
      closeModal();
    });

  // ----------------------------
  //  Start
  // ----------------------------
  loadSelection();
  setBadge();
  loadTree();
})();
