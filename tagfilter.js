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

  // ★ location.csv（G/H）: 公開CSV
  const LOCATION_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=717261533&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

  // ★ 追加: Google Sheets の export=csv を優先して取得（pub の “列が途中で切れる” 問題を回避）
  // ※下の ID は、マスターのスクショに写っているスプレッドシートIDです。
  // もし別スプレッドシートを参照する場合は、このIDだけ差し替えてください。
  const LOCATION_SPREADSHEET_ID = "1A6rJWplcH3OgZjutuGipSbD-imPssDy51pw-WGwZMpl";
  const LOCATION_GID = 717261533;
  const LOCATION_URL_EXPORT =
    "https://docs.google.com/spreadsheets/d/" + LOCATION_SPREADSHEET_ID + "/export?format=csv&gid=" + LOCATION_GID;

  const btn = document.getElementById("tagFilterBtn");
  const badge = document.getElementById("tagFilterCount");
  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = document.getElementById("tagFilterModal");
  const btnClose = document.getElementById("tagFilterClose");
  const btnClear = document.getElementById("tagFilterClear");
  const btnApply = document.getElementById("tagFilterApply");
  const colWrap = document.getElementById("tagFilterColumns");
  const titleEl = document.getElementById("tagFilterTitle");

  // 追加カテゴリ表示領域（index.htmlに既にある想定）
  const locArea = document.getElementById("tagFilterLocArea");

  if (!btn || !backdrop || !modal || !btnClose || !btnClear || !btnApply || !colWrap) return;

  // ----------------------------
  //  State
  // ----------------------------
  let treeReady = false;
  let locReady = false;

  // tree
  let root = null;
  let nodeById = new Map();
  let label = new Map();
  let parent = new Map();
  let children = new Map();
  let depth = new Map();
  let topLevel = [];

  // selection
  let selected = new Set();
  let path = []; // [l1, l2] の選択状態

  // 追加カテゴリ (location.csv G/H)
  // G: 第1カテゴリ、H: 第2カテゴリ
  const LOC_G_INDEX = 6; // G列（0-based）
  const LOC_H_INDEX = 7; // H列（0-based）
  let locGList = [];
  let locChildren = new Map(); // g -> Set(h)
  let locOpenG = null;
  let locSelectedH = new Set();

  // ----------------------------
  //  Helpers
  // ----------------------------
  function normalize(s) {
    return (s || "").toString().trim();
  }

  function csvParseLine(line) {
    const out = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
      } else if (ch === "," && !inQ) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function clearColumns() {
    colWrap.innerHTML = "";
  }

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
    return col;
  }

  function createItem(text, checked, indeterminate, withArrow) {
    const row = document.createElement("div");
    row.className = "tag-item";
    if (checked) row.classList.add("active");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;
    cb.indeterminate = !!indeterminate;

    const lab = document.createElement("label");
    lab.textContent = text;

    row.appendChild(cb);
    row.appendChild(lab);

    if (withArrow) {
      const arrow = document.createElement("span");
      arrow.textContent = "›";
      arrow.style.opacity = "0.55";
      arrow.style.marginLeft = "auto";
      row.appendChild(arrow);
    }

    return row;
  }

  function nodeHasChildren(id) {
    const ch = children.get(id);
    return ch && ch.length > 0;
  }

  // ----------------------------
  //  Tree Build
  // ----------------------------
  function buildTreeFromRows(rows) {
    // rows: [l1, l2, l3]…
    nodeById = new Map();
    label = new Map();
    parent = new Map();
    children = new Map();
    depth = new Map();

    function ensureNode(id, text, d) {
      if (!nodeById.has(id)) {
        nodeById.set(id, id);
        label.set(id, text);
        children.set(id, []);
        depth.set(id, d);
      }
    }

    root = "__root__";
    ensureNode(root, "__root__", 0);

    function makeId(d, a, b, c) {
      return `d${d}::${a || ""}::${b || ""}::${c || ""}`;
    }

    for (const r of rows) {
      const l1 = normalize(r[0]);
      const l2 = normalize(r[1]);
      const l3 = normalize(r[2]);
      if (!l1 && !l2 && !l3) continue;

      // ヘッダー行っぽいのを除外
      if (
        l1.toLowerCase() === "level1" &&
        l2.toLowerCase() === "level2" &&
        l3.toLowerCase() === "level3"
      ) {
        continue;
      }

      if (l1) {
        const id1 = makeId(1, l1);
        ensureNode(id1, l1, 1);
        parent.set(id1, root);
        if (!children.get(root).includes(id1)) children.get(root).push(id1);

        if (l2) {
          const id2 = makeId(2, l1, l2);
          ensureNode(id2, l2, 2);
          parent.set(id2, id1);
          if (!children.get(id1).includes(id2)) children.get(id1).push(id2);

          if (l3) {
            const id3 = makeId(3, l1, l2, l3);
            ensureNode(id3, l3, 3);
            parent.set(id3, id2);
            if (!children.get(id2).includes(id3)) children.get(id2).push(id3);
          }
        }
      }
    }

    // top level
    topLevel = (children.get(root) || []).slice().sort((a, b) => (label.get(a) || "").localeCompare(label.get(b) || "", "ja"));
  }

  // ----------------------------
  //  Indeterminate
  // ----------------------------
  function computeIndeterminateStates() {
    const checked = new Set();
    const indeterminate = new Set();

    // 葉（深さ3）: selected に入っているもの
    for (const id of selected) checked.add(id);

    // 下から上へ集計
    const ids = Array.from(nodeById.keys()).filter((x) => x !== root);
    ids.sort((a, b) => (depth.get(b) || 0) - (depth.get(a) || 0));

    for (const id of ids) {
      const ch = children.get(id) || [];
      if (!ch.length) continue;

      let all = true;
      let any = false;
      for (const c of ch) {
        if (checked.has(c)) any = true;
        else if (indeterminate.has(c)) any = true;
        else all = false;

        if (!checked.has(c)) all = false;
      }

      // 正確な all/any 判定
      let allChecked = true;
      let anyMarked = false;
      for (const c of ch) {
        const cChecked = checked.has(c);
        const cInd = indeterminate.has(c);
        if (cChecked || cInd) anyMarked = true;
        if (!cChecked) allChecked = false;
      }

      if (allChecked && ch.length > 0) {
        checked.add(id);
      } else if (anyMarked) {
        indeterminate.add(id);
      }
    }

    return { checked, indeterminate };
  }

  // ----------------------------
  //  Render (3 columns + loc area)
  // ----------------------------
  function renderList(col, parentId, targetDepth, checked, indeterminate) {
    const list = col.querySelector(".tag-filter-list");
    list.innerHTML = "";

    if (!parentId) return;

    const ch = (children.get(parentId) || []).slice();
    ch.sort((a, b) => (label.get(a) || "").localeCompare(label.get(b) || "", "ja"));

    for (const id of ch) {
      const text = label.get(id) || "";
      const isChecked = checked.has(id);
      const isInd = indeterminate.has(id);
      const withArrow = targetDepth < 3 && nodeHasChildren(id);

      const row = createItem(text, isChecked, isInd, withArrow);

      row.addEventListener("click", (e) => {
        e.preventDefault();

        if (targetDepth === 1) {
          path = [id];
          renderColumns();
          return;
        }
        if (targetDepth === 2) {
          path = [path[0] || null, id];
          renderColumns();
          return;
        }

        // depth 3: toggle leaf
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);

        saveSelected();
        renderColumns();
        postSelected();
      });

      list.appendChild(row);
    }
  }

  // 追加カテゴリ表示（col1末尾に入る）
  function renderLocArea() {
    if (!locArea) return;

    locArea.innerHTML = "";

    // locReady false のときは何も出さない（既存UIを壊さない）
    if (!locReady) return;

    // Gリストを col1 の「文化の下に続く」位置に出す
    // 既存と同じ見た目（tag-item）で出す
    for (const g of locGList) {
      const gId = "loc::g::" + g;
      const isActive = (locOpenG === g);

      const row = createItem(g, isActive, false, true);

      row.addEventListener("click", (e) => {
        e.preventDefault();
        locOpenG = g;
        renderColumns(); // 2カラム目にHを出す
      });

      locArea.appendChild(row);
    }
  }

  // 2カラム目に H を出す（G選択時）
  function renderLocSecondColumn(col2) {
    const list = col2.querySelector(".tag-filter-list");
    list.innerHTML = "";

    if (!locOpenG) return;

    const hs = Array.from(locChildren.get(locOpenG) || []);
    hs.sort((a, b) => a.localeCompare(b, "ja"));

    for (const h of hs) {
      const hId = "loc::h::" + locOpenG + "::" + h;
      const isChecked = locSelectedH.has(hId);

      const row = createItem(h, isChecked, false, false);

      row.addEventListener("click", (e) => {
        e.preventDefault();
        if (locSelectedH.has(hId)) locSelectedH.delete(hId);
        else locSelectedH.add(hId);

        saveSelected();
        renderColumns();
        postSelected();
      });

      list.appendChild(row);
    }
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
    renderList(col1, root, 1, checked, indeterminate);

    // 「カテゴリ」カラムの末尾＝□文化の下に続く位置
    col1.appendChild(locArea);
    cols.push(col1);

    const l1 = path[0] || null;
    const col2 = createColumn(l1 ? label.get(l1) || " " : " ");

    // ★ Gが選ばれていれば col2 は H を表示
    // （tree側の選択は壊さない。G/Hは別系統として同居）
    if (locReady && locOpenG) {
      col2.querySelector(".tag-filter-col-title").textContent = locOpenG;
      renderLocSecondColumn(col2);
    } else {
      renderList(col2, l1, 2, checked, indeterminate);
    }

    cols.push(col2);

    const l2 = path[1] || null;
    const showL2 = l2 && nodeHasChildren(l2); // ★ 2カラム目が終端(子なし)なら3カラム目のタイトルを崩さない
    const col3 = createColumn(showL2 ? (label.get(l2) || " ") : " ");
    renderList(col3, l2, 3, checked, indeterminate);
    cols.push(col3);

    for (const c of cols) colWrap.appendChild(c);

    updateBadge();
  }

  // ----------------------------
  //  Selected / Post
  // ----------------------------
  function loadSelected() {
    selected = new Set();
    locSelectedH = new Set();

    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;

      const obj = JSON.parse(raw);

      // 後方互換: 配列だった場合
      if (Array.isArray(obj)) {
        for (const id of obj) selected.add(id);
        return;
      }

      if (obj && Array.isArray(obj.selectedTags)) {
        for (const id of obj.selectedTags) selected.add(id);
      }
      if (obj && Array.isArray(obj.locSelectedH)) {
        for (const id of obj.locSelectedH) locSelectedH.add(id);
      }
      if (obj && typeof obj.locOpenG === "string") {
        locOpenG = obj.locOpenG || null;
      }
      if (obj && Array.isArray(obj.path)) {
        path = obj.path;
      }
    } catch (_) {}
  }

  function saveSelected() {
    try {
      const obj = {
        selectedTags: Array.from(selected),
        locSelectedH: Array.from(locSelectedH),
        locOpenG: locOpenG || "",
        path: Array.isArray(path) ? path : [],
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
    } catch (_) {}
  }

  function updateBadge() {
    if (!badge) return;
    const n = selected.size + locSelectedH.size;
    badge.textContent = n ? String(n) : "";
    badge.style.display = n ? "inline-block" : "none";
  }

  function postSelected() {
    // earth.html 側が既存フォーマットを期待しているので、従来の selectedTags は維持
    // 追加カテゴリ（G/H）は extra として同居させる（earth側が無視しても既存は壊れない）
    const payload = {
      type: "dd_tag_filter_apply",
      selectedTags: Array.from(selected),
      extra: {
        locG: locOpenG || "",
        locH: Array.from(locSelectedH).map((id) => {
          // id: "loc::h::<g>::<h>"
          const parts = id.split("::");
          return parts.slice(3).join("::"); // "<g>::<h>" になりやすいので後続
        }),
        locHIds: Array.from(locSelectedH),
      },
    };

    const frame = document.querySelector("iframe");
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(payload, "*");
    } else {
      window.postMessage(payload, "*");
    }
  }

  // ----------------------------
  //  Load tree.csv
  // ----------------------------
  async function loadTree() {
    let text = "";
    try {
      const r = await fetch(TREE_URL_PRIMARY, { cache: "no-store" });
      if (r.ok) text = await r.text();
    } catch (_) {}

    if (!text) {
      try {
        const r2 = await fetch(TREE_URL_FALLBACK, { cache: "no-store" });
        if (r2.ok) text = await r2.text();
      } catch (_) {}
    }

    if (!text) return [];

    const lines = text.trim().split(/\r?\n/);
    const rows = [];
    for (const line of lines) {
      if (!line) continue;
      const parts = csvParseLine(line);
      rows.push(parts);
    }
    return rows;
  }

  // ----------------------------
  //  Load location.csv (G/H)
  // ----------------------------
  async function loadLocationCats() {
    if (!locArea) return; // index.html側が未対応でも落とさない

    let text = "";

    // ★ まず export=csv を試す（pub の “列が途中で切れる” 問題を回避）
    try {
      const r0 = await fetch(LOCATION_URL_EXPORT, { cache: "no-store" });
      if (r0.ok) text = await r0.text();
    } catch (_) {}

    // 次に Primary（Google Sheets 公開CSV）
    if (!text) {
      try {
        const r = await fetch(LOCATION_URL_PRIMARY, { cache: "no-store" });
        if (r.ok) text = await r.text();
      } catch (_) {}
    }

    // 最後に Fallback（同階層の location.csv）
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

      // ★重要：行によっては末尾列（G/H）が空で、配列長が短いことがある（マスターの状況）
      // その場合でも落とさずスキップ
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
    locOpenG = (locOpenG && childMap.has(locOpenG)) ? locOpenG : (locGList[0] || null);

    locReady = true;
    renderLocArea();
  }

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal() {
    backdrop.classList.add("open");
    backdrop.setAttribute("aria-hidden", "false");
  }

  function closeModal() {
    backdrop.classList.remove("open");
    backdrop.setAttribute("aria-hidden", "true");
  }

  // ----------------------------
  //  Events
  // ----------------------------
  btn.addEventListener("click", openModal);
  btnClose.addEventListener("click", closeModal);

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

  btnClear.addEventListener("click", () => {
    selected.clear();
    locSelectedH.clear();
    saveSelected();
    renderColumns();
    postSelected();
  });

  btnApply.addEventListener("click", () => {
    saveSelected();
    postSelected();
    closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
  });

  // ----------------------------
  //  Init
  // ----------------------------
  (async function init() {
    loadSelected();

    // tree
    try {
      const rows = await loadTree();
      buildTreeFromRows(rows);
      treeReady = true;
    } catch (_) {
      treeReady = false;
    }

    // location (G/H)
    try {
      await loadLocationCats();
    } catch (_) {
      locReady = false;
      renderLocArea();
    }

    renderColumns();
    updateBadge();
  })();
})();
