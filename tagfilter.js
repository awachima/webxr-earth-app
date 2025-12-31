(function () {
  // =========================================================
  //  Tag Filter Modal (tree.csv) + Additional Categories (location.csv G/H)
  //  - "絞り込み" は tree.csv の階層カテゴリ + location.csv の追加カテゴリ(G/H) を同時に扱う
  //  - 既存UI/デザインを壊さずに、G/H を第2カラムで扱えるようにする
  // =========================================================

  const STORAGE_KEY_TREE = "dd_filter_tree_selected_v1";
  const STORAGE_KEY_LOC = "dd_filter_loc_selected_v1";
  const STORAGE_KEY_APPLIED_MODE = "dd_filter_applied_mode_v1";

  const MODE_TREE = "tree";
  const MODE_NONE = "none";

  const TREE_CSV_URL = "tree.csv"; // index.html と同階層
  const LOCATION_CSV_URL = "location.csv"; // index.html と同階層

  const btn = document.getElementById("tagFilterBtn");
  if (!btn) return;

  // ---- state ----
  const selected = new Set(); // id set
  const labels = new Map(); // id -> label

  // tree structures
  // treeRoot: Map<L1, Map<L2, Set<L3>>>
  const treeRoot = new Map();

  // location additional categories (G/H)
  // locGSet: Set<G>
  // locChildren: Map<G, Set<H>>
  const locGSet = new Set();
  const locChildren = new Map();

  // UI state
  let openL1 = null;
  let openL2 = null;
  let locOpenG = null;

  // UI elements (created on modal open)
  let modal = null;
  let overlay = null;
  let badge = null;

  // columns
  let col1 = null;
  let col2 = null;
  let col3 = null;

  // header buttons inside modal
  let applyBtn = null;
  let clearBtn = null;
  let closeBtn = null;

  // debounce postMessage
  let postTimer = null;

  // ---------------------------------------------------------
  // helpers
  // ---------------------------------------------------------
  function safeText(s) {
    return (s || "").toString().trim();
  }

  function setAppliedMode(mode) {
    try {
      localStorage.setItem(STORAGE_KEY_APPLIED_MODE, mode);
    } catch (e) {}
  }

  function getAppliedMode() {
    try {
      return localStorage.getItem(STORAGE_KEY_APPLIED_MODE) || MODE_NONE;
    } catch (e) {
      return MODE_NONE;
    }
  }

  function saveSelection() {
    // selected は tree と loc が混在しているので、prefix で分けて保存
    const treeIds = [];
    const locIds = [];
    selected.forEach((id) => {
      if (id.startsWith("tree::")) treeIds.push(id);
      else if (id.startsWith("loc::")) locIds.push(id);
    });

    try {
      localStorage.setItem(STORAGE_KEY_TREE, JSON.stringify(treeIds));
      localStorage.setItem(STORAGE_KEY_LOC, JSON.stringify(locIds));
    } catch (e) {}
  }

  function loadSelection() {
    try {
      const treeIds = JSON.parse(localStorage.getItem(STORAGE_KEY_TREE) || "[]");
      const locIds = JSON.parse(localStorage.getItem(STORAGE_KEY_LOC) || "[]");
      treeIds.forEach((id) => selected.add(id));
      locIds.forEach((id) => selected.add(id));
    } catch (e) {}
  }

  function schedulePostSelected() {
    // applyBtn がある運用なら、明示的に適用で送る（既存挙動）
    if (applyBtn) return;

    if (postTimer) clearTimeout(postTimer);
    postTimer = setTimeout(() => {
      postSelected();
      postTimer = null;
    }, 50);
  }

  function postSelected() {
    const tags = Array.from(selected)
      .map((id) => idToLabel(id))
      .filter((v) => typeof v === "string" && v.trim().length > 0);

    try {
      // iframe(earth.html) 側へ通知
      const iframe = document.getElementById("earthFrame");
      if (iframe && iframe.contentWindow) {
        iframe.contentWindow.postMessage({ type: "dd_filter_tags", tags }, "*");
      }
    } catch (e) {
      // no-op
    }
  }

  function idToLabel(id) {
    if (!id) return "";
    if (labels.has(id)) return labels.get(id) || "";

    // location.csv の追加カテゴリ (G/H) は、ラベルが未登録でも ID から復元できるようにする
    if (id.startsWith("loc::h::")) {
      const parts = id.split("::");
      return parts[parts.length - 1] || "";
    }
    if (id.startsWith("loc::g::")) {
      const parts = id.split("::");
      return parts[parts.length - 1] || "";
    }

    // tree.csv も保険
    if (id.startsWith("tree::")) {
      const parts = id.split("::");
      return parts[parts.length - 1] || "";
    }

    return id;
  }

  function setBadge() {
    if (!badge) return;
    // 以前の「数バッジ」は不要ならここで 0 にする/非表示にするが、
    // CSS 側で非表示にしている前提なので値だけ更新
    badge.textContent = String(selected.size);
  }

  // ---------------------------------------------------------
  // CSV load
  // ---------------------------------------------------------
  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("fetch failed: " + url);
    return await res.text();
  }

  function parseCSV(text) {
    // 最低限のCSV（ダブルクォート対応）
    const rows = [];
    let i = 0;
    let cur = "";
    let row = [];
    let inQ = false;

    while (i < text.length) {
      const ch = text[i];

      if (inQ) {
        if (ch === '"') {
          const next = text[i + 1];
          if (next === '"') {
            cur += '"';
            i += 2;
            continue;
          } else {
            inQ = false;
            i++;
            continue;
          }
        } else {
          cur += ch;
          i++;
          continue;
        }
      } else {
        if (ch === '"') {
          inQ = true;
          i++;
          continue;
        }
        if (ch === ",") {
          row.push(cur);
          cur = "";
          i++;
          continue;
        }
        if (ch === "\r") {
          i++;
          continue;
        }
        if (ch === "\n") {
          row.push(cur);
          rows.push(row);
          row = [];
          cur = "";
          i++;
          continue;
        }
        cur += ch;
        i++;
      }
    }

    // last
    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      rows.push(row);
    }

    return rows;
  }

  function loadTreeCats(csvText) {
    const rows = parseCSV(csvText);
    // 想定: header: L1,L2,L3,...（少なくとも3列）
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r];
      const l1 = safeText(cols[0]);
      const l2 = safeText(cols[1]);
      const l3 = safeText(cols[2]);

      if (!l1) continue;

      if (!treeRoot.has(l1)) treeRoot.set(l1, new Map());
      const m2 = treeRoot.get(l1);

      if (!l2) continue;

      if (!m2.has(l2)) m2.set(l2, new Set());
      const s3 = m2.get(l2);

      if (l3) s3.add(l3);

      // labels
      const id1 = "tree::1::" + l1;
      const id2 = "tree::2::" + l1 + "::" + l2;
      labels.set(id1, l1);
      labels.set(id2, l2);

      if (l3) {
        const id3 = "tree::3::" + l1 + "::" + l2 + "::" + l3;
        labels.set(id3, l3);
      }
    }
  }

  function loadLocationCats(csvText) {
    const rows = parseCSV(csvText);
    // location.csv は列が多いが、追加カテゴリは G/H（= 7/8列目、0-indexで6/7）
    // header行は読み飛ばす
    for (let r = 1; r < rows.length; r++) {
      const cols = rows[r] || [];
      const g = safeText(cols[6]);
      const h = safeText(cols[7]);

      if (!g) continue;

      locGSet.add(g);
      if (!locChildren.has(g)) locChildren.set(g, new Set());
      if (h) locChildren.get(g).add(h);

      const gid = "loc::g::" + g;
      labels.set(gid, g);

      if (h) {
        const hid = "loc::h::" + g + "::" + h;
        labels.set(hid, h);
      }
    }
  }

  // ---------------------------------------------------------
  // Modal UI
  // ---------------------------------------------------------
  function ensureModal() {
    if (modal) return;

    overlay = document.createElement("div");
    overlay.className = "dd-modal-overlay";

    modal = document.createElement("div");
    modal.className = "dd-modal";

    // header
    const header = document.createElement("div");
    header.className = "dd-modal-header";

    const title = document.createElement("div");
    title.className = "dd-modal-title";
    title.textContent = "絞り込み";

    const headerBtns = document.createElement("div");
    headerBtns.className = "dd-modal-actions";

    clearBtn = document.createElement("button");
    clearBtn.className = "dd-btn dd-btn-ghost";
    clearBtn.textContent = "クリア";
    clearBtn.addEventListener("click", () => {
      selected.clear();
      openL1 = null;
      openL2 = null;
      locOpenG = null;
      saveSelection();
      setBadge();
      renderColumns();
      schedulePostSelected();
    });

    applyBtn = document.createElement("button");
    applyBtn.className = "dd-btn dd-btn-primary";
    applyBtn.textContent = "適用";
    applyBtn.addEventListener("click", () => {
      setAppliedMode(MODE_TREE);
      saveSelection();
      setBadge();
      postSelected();
      closeModal();
    });

    closeBtn = document.createElement("button");
    closeBtn.className = "dd-btn dd-btn-close";
    closeBtn.innerHTML = "×";
    closeBtn.addEventListener("click", () => closeModal());

    headerBtns.appendChild(clearBtn);
    headerBtns.appendChild(applyBtn);
    headerBtns.appendChild(closeBtn);

    header.appendChild(title);
    header.appendChild(headerBtns);

    // body
    const body = document.createElement("div");
    body.className = "dd-modal-body";

    col1 = document.createElement("div");
    col1.className = "dd-col";

    col2 = document.createElement("div");
    col2.className = "dd-col";

    col3 = document.createElement("div");
    col3.className = "dd-col";

    body.appendChild(col1);
    body.appendChild(col2);
    body.appendChild(col3);

    modal.appendChild(header);
    modal.appendChild(body);

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeModal();
    });

    // ESC
    document.addEventListener("keydown", onKeyDownEsc);
  }

  function onKeyDownEsc(e) {
    if (e.key === "Escape") closeModal();
  }

  function openModal() {
    ensureModal();
    overlay.style.display = "block";
    document.body.classList.add("dd-modal-open");

    // 初回表示
    renderColumns();
    setBadge();
  }

  function closeModal() {
    if (!overlay) return;
    overlay.style.display = "none";
    document.body.classList.remove("dd-modal-open");
  }

  // ---------------------------------------------------------
  // Render Columns
  // ---------------------------------------------------------
  function clearCol(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function makeTitle(text) {
    const t = document.createElement("div");
    t.className = "dd-col-title";
    t.textContent = text;
    return t;
  }

  function makeList() {
    const list = document.createElement("div");
    list.className = "dd-list";
    return list;
  }

  function makeRow(id, text, hasChildren, onOpen) {
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
    chev.textContent = hasChildren ? "›" : "";

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    row.addEventListener("click", (e) => {
      if (e.target === cb) return;
      if (hasChildren && onOpen) onOpen();
    });

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = cb.checked;
      if (on) selected.add(id);
      else selected.delete(id);

      saveSelection();
      setBadge();
      renderColumns();
      schedulePostSelected();
    });

    return row;
  }

  function renderColumns() {
    if (!col1 || !col2 || !col3) return;

    clearCol(col1);
    clearCol(col2);
    clearCol(col3);

    // 第1カラム: tree L1 + 追加カテゴリG（同じ欄に並べる）
    col1.appendChild(makeTitle("カテゴリ"));
    const list1 = makeList();

    // tree L1
    Array.from(treeRoot.keys()).forEach((l1) => {
      const id1 = "tree::1::" + l1;
      const hasChildren = true;
      const row = makeRow(id1, l1, hasChildren, () => {
        openL1 = l1;
        openL2 = null;

        // ★tree を開いたら locOpenG は閉じる（第2カラムの混在を防ぐ）
        locOpenG = null;

        renderColumns();
      });
      list1.appendChild(row);
    });

    // location additional categories G
    // tree と見た目を揃える（同じチェックボックス・同じ行高）
    Array.from(locGSet.values()).forEach((g) => {
      const gid = "loc::g::" + g;
      const hasChildren = (locChildren.get(g) || new Set()).size > 0;

      const row = makeLocGRow(gid, g);
      list1.appendChild(row);
    });

    col1.appendChild(list1);

    // 第2カラム:
    // 1) tree L2/L3 表示
    // 2) 追加カテゴリGが開かれていれば、そのHを表示（treeとは排他）
    if (locOpenG) {
      // 追加カテゴリH
      const hArea = renderLocAreas();
      col2.appendChild(hArea);
    } else if (openL1) {
      const m2 = treeRoot.get(openL1) || new Map();
      col2.appendChild(makeTitle(openL1));

      const list2 = makeList();
      Array.from(m2.keys()).forEach((l2) => {
        const id2 = "tree::2::" + openL1 + "::" + l2;
        const s3 = m2.get(l2) || new Set();
        const hasChildren = s3.size > 0;

        const row = makeRow(id2, l2, hasChildren, () => {
          openL2 = l2;
          renderColumns();
        });

        // tree L2 の中間表示（子が一部ONの時）
        const children = Array.from(s3.values());
        if (children.length > 0) {
          let onCount = 0;
          children.forEach((l3) => {
            const id3 = "tree::3::" + openL1 + "::" + l2 + "::" + l3;
            if (selected.has(id3)) onCount++;
          });
          const cb = row.querySelector("input[type=checkbox]");
          if (cb) {
            cb.indeterminate = onCount > 0 && onCount < children.length;
            if (onCount === children.length) cb.checked = true;
          }
        }

        list2.appendChild(row);
      });

      col2.appendChild(list2);

      // 第3カラム: tree L3
      if (openL2) {
        const s3 = (treeRoot.get(openL1) || new Map()).get(openL2) || new Set();
        col3.appendChild(makeTitle(openL2));

        const list3 = makeList();
        Array.from(s3.values()).forEach((l3) => {
          const id3 = "tree::3::" + openL1 + "::" + openL2 + "::" + l3;
          const row = makeRow(id3, l3, false, null);
          list3.appendChild(row);
        });
        col3.appendChild(list3);
      }
    }
  }

  function renderLocAreas() {
    const wrap = document.createElement("div");
    wrap.className = "dd-loc-wrap";

    // タイトルは表示しない（要望：不要）
    // wrap.appendChild(makeTitle("追加カテゴリ"));

    const g = locOpenG;
    const hs = locChildren.get(g) || new Set();

    // 第2カラムに H を表示（Gは第1カラムにあるのでここでは出さない）
    const list = makeList();

    // tree と同じ node 表示（チェックボックス + ラベル）
    // ここでは「G配下H」のみを並べる
    Array.from(hs.values()).forEach((h) => {
      const hid = "loc::h::" + g + "::" + h;
      const row = makeLocHRow(hid, g, h);
      list.appendChild(row);
    });

    // Hがない場合のガイド
    if (hs.size === 0) {
      const empty = document.createElement("div");
      empty.className = "dd-muted";
      empty.textContent = "第1カテゴリを選択してください";
      wrap.appendChild(empty);
    } else {
      wrap.appendChild(list);
    }

    return wrap;
  }

  function makeLocGRow(id, text) {
    const row = document.createElement("div");
    row.className = "node";

    const cb = document.createElement("input");
    cb.type = "checkbox";

    // 子(H)の選択状態に応じて「ー(中間)」を出す（既存カテゴリと同じ見た目に合わせる）
    const kids = locChildren.get(text) || new Set();
    let selectedKids = 0;
    kids.forEach((h) => {
      const hid = "loc::h::" + text + "::" + h;
      if (selected.has(hid)) selectedKids++;
    });

    const allKidsSelected = kids.size > 0 && selectedKids === kids.size;
    const someKidsSelected = selectedKids > 0 && !allKidsSelected;

    cb.indeterminate = someKidsSelected;
    cb.checked = !someKidsSelected && (selected.has(id) || allKidsSelected);

    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = text;

    const chev = document.createElement("div");
    chev.className = "chev";
    chev.textContent = "›";

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    row.addEventListener("click", (e) => {
      // checkboxクリックは別で処理
      if (e.target === cb) return;

      // ★追加カテゴリを開いたら「第2カラムは追加カテゴリ専用」にしたいので、
      // ここでは tree の path は維持したまま locOpenG だけセットする（表示は renderColumns が制御）
      locOpenG = text;
      renderColumns();
    });

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = cb.checked;

      // Gチェック: 配下HもまとめてON/OFF
      if (on) selected.add(id);
      else selected.delete(id);

      const kids2 = locChildren.get(text) || new Set();
      kids2.forEach((h) => {
        const hid = "loc::h::" + text + "::" + h;
        if (on) selected.add(hid);
        else selected.delete(hid);
      });

      // チェック操作したら、そのGを開いた扱いにする（UX）
      locOpenG = text;

      saveSelection();
      setBadge();
      renderColumns();
      schedulePostSelected();
    });

    return row;
  }

  function makeLocHRow(id, g, h) {
    const row = document.createElement("div");
    row.className = "node";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(id);

    const lab = document.createElement("div");
    lab.className = "label";
    lab.textContent = h;

    const chev = document.createElement("div");
    chev.className = "chev";
    chev.textContent = "";

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    row.addEventListener("click", (e) => {
      if (e.target === cb) return;
      // 追加カテゴリHは3列目を使わない（現状要件なし）
    });

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = cb.checked;

      if (on) selected.add(id);
      else selected.delete(id);

      saveSelection();
      setBadge();
      renderColumns();
      schedulePostSelected();
    });

    return row;
  }

  // ---------------------------------------------------------
  // init
  // ---------------------------------------------------------
  async function init() {
    loadSelection();

    try {
      const treeText = await fetchText(TREE_CSV_URL);
      loadTreeCats(treeText);
    } catch (e) {
      // tree.csv が無い/失敗でも落とさない
    }

    try {
      const locText = await fetchText(LOCATION_CSV_URL);
      loadLocationCats(locText);
    } catch (e) {
      // location.csv が無い/失敗でも落とさない
    }

    // button badge (もし存在するなら)
    badge = document.getElementById("tagFilterBadge");

    setBadge();

    btn.addEventListener("click", () => {
      openModal();
    });

    // 初期適用モードに応じて、起動時に送る（必要なら）
    // ここでは「保存があるなら送る」で安全に
    if (selected.size > 0) {
      postSelected();
    }
  }

  init();
})();
