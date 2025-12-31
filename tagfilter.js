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

  // ★追加: location.csv（G/Hを追加カテゴリに使う）
  const LOCATION_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=717261533&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

  const btn = document.getElementById("tagFilterBtn");
  const badge = document.getElementById("tagFilterCount");

  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = backdrop ? backdrop.querySelector(".tag-filter-modal") : null;
  const closeBtn = document.getElementById("tagFilterClose");

  // ★ index.html に無い可能性があるので「任意」にする
  const applyBtn = document.getElementById("tagFilterApply");
  const clearBtn = document.getElementById("tagFilterClear");

  const colWrap = document.getElementById("tagFilterColumns");
  const locArea = document.getElementById("tagFilterLocArea");
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

  // ----------------------------
  //  location.csv(G/H) -> extra category UI
  // ----------------------------
  // 既定は G/H (0始まりで 6/7)
  let LOC_G_INDEX = 6;
  let LOC_H_INDEX = 7;

  let locReady = false;
  let locGList = []; // ["街", "自然", ...]
  let locChildren = new Map(); // G -> Set(H)
  let locOpenG = null; // 右ペインに出す対象G
  let locDebugMessage = ""; // 表示だけ（壊さない）

  function guessLocationGHIndexFromHeader(headerCells) {
    // ヘッダー名からG/Hに相当する列を推定する（見つからなければ null）
    const h = (headerCells || []).map((x) => normalize(x).toLowerCase());

    // よくありそうな候補（必要になったら追加）
    const gCandidates = ["g", "tag_g", "tagg", "genre_g", "miss_g", "category_g", "extra_g", "levelg", "level_4"];
    const hCandidates = ["h", "tag_h", "tagh", "genre_h", "miss_h", "category_h", "extra_h", "levelh", "level_5"];

    let gi = -1;
    let hi = -1;

    for (const key of gCandidates) {
      const idx = h.indexOf(key);
      if (idx >= 0) {
        gi = idx;
        break;
      }
    }
    for (const key of hCandidates) {
      const idx = h.indexOf(key);
      if (idx >= 0) {
        hi = idx;
        break;
      }
    }

    if (gi >= 0 && hi >= 0) return { gi, hi };

    // "miss" 系がありそうなら miss を含む列を探す（g/h相当を2本）
    const missCols = [];
    h.forEach((name, idx) => {
      if (name.includes("miss")) missCols.push(idx);
    });
    if (missCols.length >= 2) {
      return { gi: missCols[0], hi: missCols[1] };
    }

    return null;
  }

  async function loadLocationCats() {
    if (!locArea) return; // index.html側が未対応でも落とさない

    let text = "";
    locDebugMessage = "";

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

    // 先頭行をヘッダー候補として解析し、列名からG/H推定を試す
    try {
      const headCells = csvParseLine(lines[0]);
      const guessed = guessLocationGHIndexFromHeader(headCells);
      if (guessed) {
        LOC_G_INDEX = guessed.gi;
        LOC_H_INDEX = guessed.hi;
      }
    } catch (_) {}

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

    // 列数不足チェック（最低でもHまで必要）
    // ※ 行によって列数が違うCSVもあり得るので、まずは先頭の列数で雑に判断し、最終的には各行で防御する
    try {
      const firstData = csvParseLine(lines[Math.min(start, lines.length - 1)]);
      if ((firstData || []).length <= LOC_G_INDEX) {
        locDebugMessage =
          "location.csv の列数が想定より少ないため、G/H を読み取れません（公開CSVにG/Hが含まれているか確認してください）";
      }
    } catch (_) {}

    for (let i = start; i < lines.length; i++) {
      const parts = csvParseLine(lines[i]);

      // 行ごとに列数が足りない場合はスキップ
      if (!parts || parts.length <= LOC_G_INDEX) continue;

      const g = normalize(parts[LOC_G_INDEX]);
      const h = parts.length > LOC_H_INDEX ? normalize(parts[LOC_H_INDEX]) : "";

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

    // デバッグメッセージ（表示だけ。既存UIは壊さない）
    if (locDebugMessage) {
      const msg0 = document.createElement("div");
      msg0.style.opacity = "0.65";
      msg0.style.padding = "6px 2px";
      msg0.style.fontSize = "12px";
      msg0.textContent = locDebugMessage;
      left.appendChild(msg0);
    }

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

  function setBadge() {
    // (0) も含めて常に表示（既存UI仕様に合わせる）
    try {
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
          arr
            .map((x) => String(x))
            .filter((id) => id && id !== ROOT_ID && id !== EMPTY_ID)
        );
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
    if (!nodeId || nodeId === ROOT_ID || nodeId === EMPTY_ID) return;
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

    // ▼▼ 追加カテゴリ（location.csv G/H）を「カテゴリ枠(col1)の中」に入れる ▼▼
    if (locArea) {
      // 以前どこかに入れていた場合は取り外してから入れ直す（重複表示防止）
      if (locArea.parentNode) locArea.parentNode.removeChild(locArea);

      // “カテゴリ枠の中で表示するモード”用のクラス（CSSで使うなら）
      locArea.classList.add("loc-area-in-col1");

      // 「カテゴリ」カラムの末尾＝□文化の下に続く位置
      col1.appendChild(locArea);
    }
    // ▲▲ ここまで ▲▲

    cols.push(col1);

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
  //  Load tree (CSV)
  // ----------------------------
  async function fetchCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed: " + res.status);
    return await res.text();
  }

  function buildTreeFromCsv(csvText) {
    nodesById.clear();
    childrenByParent.clear();
    label.clear();
    parent.clear();
    depthById.clear();
    pathById.clear();

    nodesById.set(ROOT_ID, {
      id: ROOT_ID,
      label: "ROOT",
      depth: 0,
      parentId: null,
      children: new Set(),
    });
    label.set(ROOT_ID, "ROOT");
    parent.set(ROOT_ID, null);
    depthById.set(ROOT_ID, 0);

    const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length <= 1) return;

    const header = csvParseLine(lines[0]).map((s) => normalize(s).toLowerCase());
    const idx1 = header.indexOf("level1");
    const idx2 = header.indexOf("level2");
    const idx3 = header.indexOf("level3");
    if (idx1 < 0) return;

    // Each row creates nodes for each level; nodeId is built from path
    for (let i = 1; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]);
      const l1 = normalize(cols[idx1]);
      const l2 = idx2 >= 0 ? normalize(cols[idx2]) : "";
      const l3 = idx3 >= 0 ? normalize(cols[idx3]) : "";

      if (!l1) continue;

      // ★防御: データ行に "level1/level2/level3" が混ざっていてもツリーにしない
      const a = l1.toLowerCase();
      const b = (l2 || "").toLowerCase();
      const c = (l3 || "").toLowerCase();
      if (a === "level1" && (b === "level2" || b === "") && (c === "level3" || c === "")) {
        continue;
      }

      const id1 = "L1|" + safeIdFromLabel(l1);
      addNode(id1, l1, 1, ROOT_ID);

      if (l2) {
        const id2 = id1 + "|L2|" + safeIdFromLabel(l2);
        addNode(id2, l2, 2, id1);

        if (l3) {
          const id3 = id2 + "|L3|" + safeIdFromLabel(l3);
          addNode(id3, l3, 3, id2);
        }
      }
    }
  }

  async function loadTree() {
    treeReady = false;
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
    } catch (e2) {
      treeReady = false;
    }
  }

  // ----------------------------
  //  Init
  // ----------------------------
  loadSelection();
  setBadge();
  loadTree();
})();
