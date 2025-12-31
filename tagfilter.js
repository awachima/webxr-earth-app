(function () {
  // ----------------------------
  //  Tag Filter Modal (tree.csv) + Miss Notice (location.csv G/H)
  //  - "絞り込み" と "見逃し注意" は排他（どちらか一方だけ適用）
  //  - 選択数バッジ表示は不要（CSSで非表示）
  // ----------------------------

  const STORAGE_KEY_TREE = "dd_filter_tree_selected_v1";
  const STORAGE_KEY_MISS = "dd_filter_miss_selected_v1";
  const STORAGE_KEY_APPLIED_MODE = "dd_filter_applied_mode_v1"; // 'tree' | 'miss' | 'none'
  const STORAGE_KEY_SELECTED_TAGS = "dd_selected_tags_v1";

  // ★ Google Sheets「ウェブに公開」(CSV) を読む
  // tree.csv … 絞り込み UI 用（階層）
  // location.csv … 見逃し注意 UI 用（追加カテゴリ）
  // ※ここはあなたの環境に合わせて既存値を維持してください
  const TREE_CSV_URL = "tree.csv";
  const LOCATION_CSV_URL = "location.csv";

  const MODE_TREE = "tree";
  const MODE_MISS = "miss";
  const MODE_NONE = "none";

  // ----------------------------
  // state
  // ----------------------------
  const selected = new Set(); // 例: "tree::0::1::2" / "loc::g::xxx" / "loc::h::g::h"
  const label = new Map(); // id -> 表示文字列
  let appliedMode = MODE_NONE;

  // Location (追加カテゴリ) の親子状態管理
  const locGCheckboxEl = new Map(); // Map<locGId, HTMLInputElement>
  const locGChildSelectedCount = new Map(); // Map<locGId, number>
  const locGChildTotalCount = new Map(); // Map<locGId, number>
  const locGImplicitSelected = new Set(); // Set<locGId> (H選択により暗黙選択)

  function locGIdOf(gName) {
    return `loc::g::${gName}`;
  }

  function bumpLocGChildCount(locGId, delta) {
    const cur = locGChildSelectedCount.get(locGId) || 0;
    const next = Math.max(0, cur + delta);
    locGChildSelectedCount.set(locGId, next);
  }

  function updateLocGVisualState(locGId) {
    const cb = locGCheckboxEl.get(locGId);
    if (!cb) return;
    const childSelected = locGChildSelectedCount.get(locGId) || 0;
    const total = locGChildTotalCount.get(locGId) || 0;
    // 子が1つでも選択されていて、親が明示チェックされていない場合は indeterminate を立てる
    cb.indeterminate = childSelected > 0 && !selected.has(locGId);
    // 明示チェックがOFFで、子選択がある場合は地球儀反映のため親を暗黙選択に加える
    if (!selected.has(locGId) && childSelected > 0) {
      locGImplicitSelected.add(locGId);
    } else {
      locGImplicitSelected.delete(locGId);
    }
    // もし親が明示チェックされているなら indeterminate は不要
    if (selected.has(locGId)) cb.indeterminate = false;
  }

  // ----------------------------
  // helpers
  // ----------------------------
  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }
  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function loadState() {
    try {
      const mode = localStorage.getItem(STORAGE_KEY_APPLIED_MODE);
      if (mode === MODE_TREE || mode === MODE_MISS || mode === MODE_NONE) {
        appliedMode = mode;
      } else {
        appliedMode = MODE_NONE;
      }
    } catch (e) {
      appliedMode = MODE_NONE;
    }

    // どちらのモードでも selected は同じ Set に入れて扱う（表示切替で塗り替え）
    // 起動時は最後に保存された tags を復元
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SELECTED_TAGS);
      if (raw) {
        const arr = JSON.parse(raw);
        if (Array.isArray(arr)) {
          arr.forEach((id) => selected.add(id));
        }
      }
    } catch (e) {}
  }

  function saveSelected() {
    try {
      localStorage.setItem(STORAGE_KEY_SELECTED_TAGS, JSON.stringify(Array.from(selected)));
    } catch (e) {}
  }

  function setAppliedMode(mode) {
    appliedMode = mode;
    try {
      localStorage.setItem(STORAGE_KEY_APPLIED_MODE, appliedMode);
    } catch (e) {}
  }

  // ----------------------------
  // postMessage to earth iframe
  // ----------------------------
  let postTimer = null;
  function schedulePostSelected() {
    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      postTimer = null;
      postSelected();
    }, 30);
  }

  function postSelected() {
    // earth.html へ送る payload は "tags" 互換を維持
    // 追加カテゴリ(第2)だけ選択されても反映されるよう、親(第1)を暗黙的に含める
    const allIds = new Set([...selected, ...locGImplicitSelected]);
    const tags = Array.from(allIds)
      .map((id) => label.get(id) || id)
      .map((s) => String(s).trim())
      .filter(Boolean);

    try {
      localStorage.setItem("dd_selected_tags", JSON.stringify(tags));
    } catch (e) {}

    // iframe 探索
    const frame = qs("iframe#earthFrame") || qs("iframe");
    if (!frame || !frame.contentWindow) return;

    frame.contentWindow.postMessage(
      {
        type: "DD_FILTER_TAGS",
        tags,
      },
      "*"
    );
  }

  // ----------------------------
  // UI elements
  // ----------------------------
  function ensureModal() {
    let modal = qs("#tagFilterModal");
    if (modal) return modal;

    modal = document.createElement("div");
    modal.id = "tagFilterModal";
    modal.className = "tag-filter-modal";
    modal.innerHTML = `
      <div class="tag-filter-backdrop"></div>
      <div class="tag-filter-dialog" role="dialog" aria-modal="true">
        <div class="tag-filter-header">
          <div class="tag-filter-title">絞り込み</div>
          <div class="tag-filter-actions">
            <button type="button" class="tag-filter-clear">クリア</button>
            <button type="button" class="tag-filter-apply">適用</button>
            <button type="button" class="tag-filter-close" aria-label="Close">×</button>
          </div>
        </div>
        <div class="tag-filter-body">
          <div class="tag-filter-columns">
            <div class="tag-filter-col tag-filter-col1">
              <div class="tag-filter-col-title">カテゴリ</div>
              <div class="tag-filter-list tag-filter-list1"></div>
            </div>
            <div class="tag-filter-col tag-filter-col2">
              <div class="tag-filter-col-title tag-filter-col2-title"></div>
              <div class="tag-filter-list tag-filter-list2"></div>
            </div>
            <div class="tag-filter-col tag-filter-col3">
              <div class="tag-filter-col-title tag-filter-col3-title"></div>
              <div class="tag-filter-list tag-filter-list3"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    // backdrop close
    qs(".tag-filter-backdrop", modal).addEventListener("click", () => closeModal());

    // close btn
    qs(".tag-filter-close", modal).addEventListener("click", () => closeModal());

    // clear
    qs(".tag-filter-clear", modal).addEventListener("click", () => {
      selected.clear();
      locGImplicitSelected.clear();
      // indeterminate reset
      locGCheckboxEl.forEach((cb) => (cb.indeterminate = false));
      locGChildSelectedCount.clear();
      saveSelected();
      setAppliedMode(MODE_NONE);
      renderAll();
      postSelected();
    });

    // apply
    qs(".tag-filter-apply", modal).addEventListener("click", () => {
      saveSelected();
      // 適用時は「どちらのモードでもOK」だが、現在表示の内容で決定する
      // ここでは表示の状態から推測: 追加カテゴリが開いていれば miss、それ以外は tree
      // （既存実装の意図を壊さないため、mode は現状維持しつつ none を避ける）
      if (appliedMode === MODE_NONE) {
        // 何か選択があれば tree とする
        if (selected.size > 0 || locGImplicitSelected.size > 0) setAppliedMode(MODE_TREE);
      }
      postSelected();
      closeModal();
    });

    return modal;
  }

  function openModal() {
    const modal = ensureModal();
    modal.classList.add("open");
    // 初回描画
    renderAll();
  }

  function closeModal() {
    const modal = qs("#tagFilterModal");
    if (!modal) return;
    modal.classList.remove("open");
  }

  // ----------------------------
  // CSV parsing
  // ----------------------------
  function parseCsv(text) {
    // シンプル CSV（ダブルクォートや改行も考慮）
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;

    function endField() {
      row.push(field);
      field = "";
    }
    function endRow() {
      rows.push(row);
      row = [];
    }

    while (i < text.length) {
      const c = text[i];

      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i += 1;
          continue;
        }
        field += c;
        i += 1;
        continue;
      }

      if (c === '"') {
        inQuotes = true;
        i += 1;
        continue;
      }
      if (c === ",") {
        endField();
        i += 1;
        continue;
      }
      if (c === "\r") {
        // skip
        i += 1;
        continue;
      }
      if (c === "\n") {
        endField();
        endRow();
        i += 1;
        continue;
      }
      field += c;
      i += 1;
    }

    // last
    endField();
    if (row.length > 1 || (row.length === 1 && row[0] !== "")) endRow();
    return rows;
  }

  async function fetchCsv(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`fetch failed: ${url}`);
    const text = await res.text();
    return parseCsv(text);
  }

  // ----------------------------
  // tree (絞り込み) UI
  // ----------------------------
  let treeLoaded = false;
  let treeData = null; // { l1: Map, ... }

  function buildTreeData(rows) {
    // rows: [ [L1,L2,L3,L4], ... ]
    // ここではヘッダがあってもなくても動くように、L1..L4 の列数で扱う
    const root = new Map(); // l1 -> Map

    rows.forEach((r) => {
      const L1 = (r[0] || "").trim();
      const L2 = (r[1] || "").trim();
      const L3 = (r[2] || "").trim();
      const L4 = (r[3] || "").trim();
      if (!L1) return;

      if (!root.has(L1)) root.set(L1, new Map());
      const m2 = root.get(L1);

      if (L2) {
        if (!m2.has(L2)) m2.set(L2, new Map());
        const m3 = m2.get(L2);

        if (L3) {
          if (!m3.has(L3)) m3.set(L3, new Set());
          const s4 = m3.get(L3);

          if (L4) s4.add(L4);
        }
      }
    });

    return root;
  }

  function treeId(l1, l2, l3, l4) {
    const parts = ["tree", l1 || "", l2 || "", l3 || "", l4 || ""].map((s) => String(s));
    return parts.join("::");
  }

  function makeTreeRow(id, text, level, hasChildren) {
    const row = document.createElement("div");
    row.className = "tag-filter-row";
    row.dataset.id = id;

    const left = document.createElement("div");
    left.className = "tag-filter-row-left";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(id);

    const span = document.createElement("span");
    span.className = "tag-filter-row-text";
    span.textContent = text;

    left.appendChild(cb);
    left.appendChild(span);

    const chev = document.createElement("div");
    chev.className = "tag-filter-row-chev";
    chev.textContent = hasChildren ? "›" : "";

    row.appendChild(left);
    row.appendChild(chev);

    label.set(id, text);

    row.addEventListener("click", (e) => {
      // checkboxクリック以外でも toggle
      if (e.target === cb) return;
      if (!hasChildren) cb.click();
      else {
        // 子がある場合は行クリックで展開
        setTreeOpen(id, level);
        renderTreeColumns();
      }
    });

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
    });
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(id);
      else selected.delete(id);
      saveSelected();
      schedulePostSelected();
      // indeterminate 表示は tree側ではCSS/既存ロジックに任せる（変更しない）
    });

    return row;
  }

  let treeOpenL1 = null;
  let treeOpenL2 = null;

  function setTreeOpen(id, level) {
    if (level === 1) {
      treeOpenL1 = id;
      treeOpenL2 = null;
    }
    if (level === 2) {
      treeOpenL2 = id;
    }
  }

  function renderTreeColumns() {
    const modal = ensureModal();
    const list1 = qs(".tag-filter-list1", modal);
    const list2 = qs(".tag-filter-list2", modal);
    const list3 = qs(".tag-filter-list3", modal);
    const title2 = qs(".tag-filter-col2-title", modal);
    const title3 = qs(".tag-filter-col3-title", modal);

    list1.innerHTML = "";
    list2.innerHTML = "";
    list3.innerHTML = "";
    title2.textContent = "";
    title3.textContent = "";

    if (!treeData) return;

    // col1
    const L1s = Array.from(treeData.keys());
    L1s.forEach((l1) => {
      const id1 = treeId(l1);
      const m2 = treeData.get(l1);
      const hasChildren = m2 && m2.size > 0;
      const row = makeTreeRow(id1, l1, 1, hasChildren);
      list1.appendChild(row);
    });

    // col2
    if (treeOpenL1) {
      const parts = treeOpenL1.split("::");
      const l1 = parts[1] || "";
      title2.textContent = l1;

      const m2 = treeData.get(l1);
      if (m2) {
        const L2s = Array.from(m2.keys());
        L2s.forEach((l2) => {
          const id2 = treeId(l1, l2);
          const m3 = m2.get(l2);
          const hasChildren = m3 && m3.size > 0;
          const row = makeTreeRow(id2, l2, 2, hasChildren);
          list2.appendChild(row);
        });
      }
    }

    // col3
    if (treeOpenL1 && treeOpenL2) {
      const p1 = treeOpenL1.split("::");
      const l1 = p1[1] || "";
      const p2 = treeOpenL2.split("::");
      const l2 = p2[2] || "";
      title3.textContent = l2;

      const m2 = treeData.get(l1);
      const m3 = m2 ? m2.get(l2) : null;
      if (m3) {
        // col3 は L3 と L4 を同列表示する既存仕様（壊さない）
        Array.from(m3.keys()).forEach((l3) => {
          const id3 = treeId(l1, l2, l3);
          const s4 = m3.get(l3);
          const hasChildren = s4 && s4.size > 0;
          const row3 = makeTreeRow(id3, l3, 3, hasChildren);
          list3.appendChild(row3);

          if (hasChildren) {
            Array.from(s4).forEach((l4) => {
              const id4 = treeId(l1, l2, l3, l4);
              const row4 = makeTreeRow(id4, "  " + l4, 4, false);
              row4.classList.add("tag-filter-row-l4");
              list3.appendChild(row4);
            });
          }
        });
      }
    }
  }

  // ----------------------------
  // location (追加カテゴリ) UI
  // ----------------------------
  let locLoaded = false;
  let locGList = [];
  let locChildren = new Map(); // g -> Set<h>
  let locOpenG = null;

  function locHId(g, h) {
    return `loc::h::${g}::${h}`;
  }

  function makeLocGRow(g) {
    const id = locGIdOf(g);

    const row = document.createElement("div");
    row.className = "tag-filter-row";
    row.dataset.id = id;

    const left = document.createElement("div");
    left.className = "tag-filter-row-left";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(id);
    // 追加カテゴリ(第1) の indeterminate 表示制御用
    locGCheckboxEl.set(id, cb);
    if (!locGChildSelectedCount.has(id)) locGChildSelectedCount.set(id, 0);

    const span = document.createElement("span");
    span.className = "tag-filter-row-text";
    span.textContent = g;

    left.appendChild(cb);
    left.appendChild(span);

    const chev = document.createElement("div");
    chev.className = "tag-filter-row-chev";
    chev.textContent = "›";

    row.appendChild(left);
    row.appendChild(chev);

    label.set(id, g);

    row.addEventListener("click", (e) => {
      if (e.target === cb) return;
      // 展開
      locOpenG = g;
      renderLocAreas();
    });

    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      if (cb.checked) selected.add(id);
      else selected.delete(id);
      saveSelected();
      updateLocGVisualState(id);
      schedulePostSelected();
    });

    return row;
  }

  function makeLocHRow(id, text) {
    const row = document.createElement("div");
    row.className = "tag-filter-row";
    row.dataset.id = id;

    const left = document.createElement("div");
    left.className = "tag-filter-row-left";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(id);

    const span = document.createElement("span");
    span.className = "tag-filter-row-text";
    span.textContent = text;

    left.appendChild(cb);
    left.appendChild(span);

    const chev = document.createElement("div");
    chev.className = "tag-filter-row-chev";
    chev.textContent = "";

    row.appendChild(left);
    row.appendChild(chev);

    label.set(id, text);

    row.addEventListener("click", (e) => {
      if (e.target === cb) return;
      cb.checked = !cb.checked;
      cb.dispatchEvent(new Event("change", { bubbles: true }));
    });

    cb.addEventListener("click", (e) => e.stopPropagation());
    cb.addEventListener("change", () => {
      const on = cb.checked;
      if (on) selected.add(id);
      // 追加カテゴリ(第2) の選択に応じて、親(第1)を indeterminate 表示にし、地球儀反映のため暗黙選択に加える
      if (id.startsWith('loc::h::')) {
        const parts = id.split('::');
        const parentId = locGIdOf(parts[2]);
        bumpLocGChildCount(parentId, on ? 1 : -1);
        updateLocGVisualState(parentId);
      }
      else selected.delete(id);

      saveSelected();
      schedulePostSelected();
    });

    return row;
  }

  function renderLocAreas() {
    const modal = ensureModal();
    const list1 = qs(".tag-filter-list1", modal);
    const list2 = qs(".tag-filter-list2", modal);
    const list3 = qs(".tag-filter-list3", modal);
    const title2 = qs(".tag-filter-col2-title", modal);
    const title3 = qs(".tag-filter-col3-title", modal);

    list1.innerHTML = "";
    list2.innerHTML = "";
    list3.innerHTML = "";
    title2.textContent = "";
    title3.textContent = "";

    // col1: 既存カテゴリ（treeのL1）を見せるのではなく、ここでは「追加カテゴリ（第1）」は別表示にしない方針を維持
    // ただし、UI上は tree と統合済みのため、ここは treeColumns が描画済みの想定。
    // この関数は「追加カテゴリの第2カラム」を差し替える役割のみ。

    // ※ 現行UIでは、追加カテゴリは第2カラム内に表示する設計（既存の見た目を壊さない）
    // ここでは第2カラム(list2)に「追加カテゴリ（第2）」を表示する

    // col2 title：不要（表示しない＝空文字）
    // col2 list：locOpenG が決まっていれば第2候補を表示
    if (!locOpenG) return;

    const children = locChildren.get(locOpenG);
    if (!children) return;

    // 第2候補を表示（タイトルは不要）
    Array.from(children).forEach((h) => {
      const id = locHId(locOpenG, h);
      const row = makeLocHRow(id, h);
      list2.appendChild(row);
    });
  }

  async function loadLocCsv() {
    const rows = await fetchCsv(LOCATION_CSV_URL);
    // location.csv: ヘッダあり想定（titleJp,lat,lng,url,G,H,... など）
    // ただし列位置が変わっても動くようにヘッダから探す
    if (!rows || rows.length === 0) return;

    const header = rows[0].map((s) => String(s || "").trim());
    const idxG = header.findIndex((h) => h === "G");
    const idxH = header.findIndex((h) => h === "H");

    // ヘッダがない場合の保険（G/H が見つからない時）
    const fallbackIdxG = 6; // 0-based: G
    const fallbackIdxH = 7; // 0-based: H

    const gSet = new Set();
    const childMap = new Map(); // g -> Set<h>

    rows.slice(1).forEach((r) => {
      const g = String((idxG >= 0 ? r[idxG] : r[fallbackIdxG]) || "").trim();
      const h = String((idxH >= 0 ? r[idxH] : r[fallbackIdxH]) || "").trim();
      if (!g) return;

      gSet.add(g);
      if (!childMap.has(g)) childMap.set(g, new Set());
      if (h) childMap.get(g).add(h);

      // ラベル登録（postSelected の互換）
      const gid = locGIdOf(g);
      label.set(gid, g);

      if (h) {
        const hid = locHId(g, h);
        label.set(hid, h);
      }
    });

    locGList = Array.from(gSet);
    locChildren = childMap;

    // 既に選択状態がある場合、子選択数を復元して indeterminate を再現
    // （保存しているのは selected のみなので、selected から再計算）
    // locGChildSelectedCount は子の id から親を数える
    locGChildSelectedCount.clear();
    locGImplicitSelected.clear();

    selected.forEach((id) => {
      if (id.startsWith("loc::h::")) {
        const parts = id.split("::");
        const gName = parts[2];
        const parentId = locGIdOf(gName);
        bumpLocGChildCount(parentId, 1);
      }
    });

    locLoaded = true;
  }

  // ----------------------------
  // renderAll
  // ----------------------------
  function renderAll() {
    const modal = ensureModal();

    // まず tree を描画
    renderTreeColumns();

    // 追加カテゴリ（第1）は tree の L1 に統合されている前提のため、
    // loc側は第2カラムだけ差し替える（UIを壊さないため）
    // ※ locOpenG の選択は tree のクリックに合わせて設定されている想定だが、
    //   既存実装に合わせ、ここでは locOpenG があれば描画する
    if (locLoaded) {
      // G 列の indeterminate 表示のため、Gの総数を記録（ここはレンダリングのタイミングでOK）
      // ただし checkboxEl は makeLocGRow 時に登録されるので、ここでは第2のみ描画する
      renderLocAreas();
    }
  }

  // ----------------------------
  // Hook: 既存カテゴリ(L1)クリック時に locOpenG を同期
  // ----------------------------
  function hookTreeClicksToLoc() {
    const modal = ensureModal();
    const list1 = qs(".tag-filter-list1", modal);
    if (!list1) return;

    // イベント委譲: L1 行クリックで locOpenG 更新（該当があれば）
    list1.addEventListener("click", (e) => {
      const row = e.target.closest(".tag-filter-row");
      if (!row) return;
      const id = row.dataset.id || "";
      if (!id.startsWith("tree::")) return;

      const parts = id.split("::");
      const l1 = parts[1] || "";

      // locGList に存在する場合のみ locOpenG を更新
      if (locGList.includes(l1)) {
        locOpenG = l1;
        renderLocAreas();
      } else {
        // 既存カテゴリを選んだら追加カテゴリの第2は空にする（混在防止）
        locOpenG = null;
        renderLocAreas();
      }
    });
  }

  // ----------------------------
  // bootstrap
  // ----------------------------
  async function init() {
    loadState();
    ensureModal();

    // CSV 読み込み
    try {
      const treeRows = await fetchCsv(TREE_CSV_URL);
      treeData = buildTreeData(treeRows.slice(1)); // 先頭がヘッダでも OK
      treeLoaded = true;
    } catch (e) {
      // tree が読めなくても動作継続
      treeLoaded = false;
      treeData = new Map();
    }

    try {
      await loadLocCsv();
    } catch (e) {
      locLoaded = false;
      locGList = [];
      locChildren = new Map();
    }

    // tree クリックに loc を同期
    hookTreeClicksToLoc();

    // 外部ボタン（絞り込みボタン）を探して openModal に繋ぐ
    // 既存の UI を壊さないため、候補を複数見る
    const openBtn =
      qs("#tagFilterButton") ||
      qs(".tag-filter-open") ||
      qs("button[data-open-tagfilter]") ||
      qs("img#filterIcon") ||
      null;

    if (openBtn) {
      openBtn.addEventListener("click", (e) => {
        e.preventDefault();
        openModal();
      });
    } else {
      // 既存の filter.png ボタンがある場合はそれを拾う
      const imgBtn = qsa("img").find((img) => (img.getAttribute("src") || "").includes("filter.png"));
      if (imgBtn) {
        imgBtn.style.cursor = "pointer";
        imgBtn.addEventListener("click", (e) => {
          e.preventDefault();
          openModal();
        });
      }
    }

    // 初回 post
    postSelected();
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
