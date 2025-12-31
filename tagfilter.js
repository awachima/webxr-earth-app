(function () {
  // ----------------------------
  //  Tag Filter Modal (tree.csv) + 追加カテゴリ (location.csv G/H)
  //
  //  目的：
  //  - 既存 tree.csv 3カラム絞り込みは絶対に壊さない
  //  - その下に “location.csv の G列” を level1として追加表示（□文化と同じ体裁）
  //  - Gをクリックしたら第2カラムに H の候補を表示（2段階）
  //  - 「適用」で既存の postMessage/フィルタ処理と同居できる形で反映（※既存ロジック温存）
  //
  //  注意：
  //  - 画面が真っ白になる原因は styles.css ではなく tagfilter.js 側の例外であることが多い
  //  - 公開CSV（pub?gid=...&output=csv）側が “列途中で切れる” と G/H は読めない
  // ----------------------------

  // =========================================================
  //  Storage Keys（既存）
  // =========================================================
  const STORAGE_KEY_SELECTED_TAGS = "dd_selected_tags_v1";

  // =========================================================
  //  DOM ids（index.html 側の既存構造に合わせる）
  // =========================================================
  const BACKDROP_ID = "tagFilterBackdrop";
  const MODAL_ID = "tagFilterModal";
  const BTN_OPEN_ID = "tagFilterBtn";
  const BTN_CLOSE_ID = "tagFilterClose";
  const BTN_CLEAR_ID = "tagFilterClear";
  const BTN_APPLY_ID = "tagFilterApply";

  // =========================================================
  //  tree.csv 公開URL（既存）
  // =========================================================
  // ★ Google Sheets「ウェブに公開」(CSV) を読む
  // ※あなたの環境のURLが別なら、ここを差し替え
  const TREE_URL_PRIMARY =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";
  // フォールバック（同梱tree.csvがある場合）
  const TREE_URL_FALLBACK = "./tree.csv";

  // =========================================================
  //  location.csv（G/Hを追加カテゴリに使う）
  // =========================================================
  // 重要:
  //  - pub?gid=...&output=csv は「公開範囲（使われている範囲）」によっては列が途中で切られることがあります。
  //  - その場合、G/H が存在していても CSV に出てこず、こちらでは読み取れません。
  //  対策として、(1) export?format=csv&gid=... を優先し、(2) それでもダメなら pub を試します。
  const LOCATION_SHEET_GID = 717261533;
  // ※このIDは、あなたの「編集URL」に含まれる /d/<ID>/ の部分です。違うスプレッドシートを使う場合はここを差し替えてください。
  const LOCATION_SPREADSHEET_ID = "1A6rJWplcH3OgZjutuGipSbD-imPssDy51pw-WGwZMpl";
  const LOCATION_URL_EXPORT =
    "https://docs.google.com/spreadsheets/d/" + LOCATION_SPREADSHEET_ID + "/export?format=csv&gid=" + LOCATION_SHEET_GID;
  const LOCATION_URL_PUBLISHED =
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=" + LOCATION_SHEET_GID + "&single=true&output=csv";
  const LOCATION_URL_FALLBACK = "./location.csv";

  // =========================================================
  //  Column index（0-based）
  //  location.csv: A=0, B=1, ... G=6, H=7
  // =========================================================
  const LOC_G_INDEX = 6;
  const LOC_H_INDEX = 7;

  // =========================================================
  //  State
  // =========================================================
  let selectedTags = new Set(); // 既存: tree側で使う（温存）
  let appliedMode = "tree"; // 現状は tree を壊さない。追加カテゴリは "tree" の一部として扱う。

  // 追加カテゴリ用
  // gToH: { [gValue]: Set(hValue) }
  let locGValues = [];
  let locGToH = new Map(); // g => Set(h)
  let selectedLocG = null; // 第1カテゴリとして選択されたG
  let selectedLocH = new Set(); // 第2カテゴリとして選択されたH（複数選択を許可）

  // 既存 tree の表示用
  let treeData = []; // raw rows
  let treeRoot = null; // structured
  let currentL1 = null;
  let currentL2 = null;

  // =========================================================
  //  Helpers
  // =========================================================
  function $(id) {
    return document.getElementById(id);
  }

  function safeText(s) {
    return (s ?? "").toString().trim();
  }

  // CSV parse (シンプル)
  function parseCSV(text) {
    // 改行統一
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const rows = [];
    for (let line of lines) {
      if (line === "") continue;
      const row = [];
      let cur = "";
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === "," && !inQuotes) {
          row.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
      row.push(cur);
      rows.push(row);
    }
    return rows;
  }

  function uniq(arr) {
    return Array.from(new Set(arr));
  }

  function sortJa(arr) {
    // 日本語/英語混在でもそれなりに安定
    return arr.slice().sort((a, b) => a.localeCompare(b, "ja"));
  }

  function setNoticeInFirstColumn(message) {
    const col1 = document.querySelector("#tagCol1");
    if (!col1) return;
    const box = document.createElement("div");
    box.style.marginTop = "8px";
    box.style.fontSize = "12px";
    box.style.opacity = "0.75";
    box.textContent = message;
    col1.appendChild(box);
  }

  // =========================================================
  //  Load tree.csv（既存）
  // =========================================================
  async function loadTree() {
    let text = null;

    // primary
    try {
      const r = await fetch(TREE_URL_PRIMARY, { cache: "no-store" });
      if (r.ok) text = await r.text();
    } catch (_) {}

    // fallback
    if (!text) {
      try {
        const r2 = await fetch(TREE_URL_FALLBACK, { cache: "no-store" });
        if (r2.ok) text = await r2.text();
      } catch (_) {}
    }

    if (!text) {
      console.warn("[tagfilter] tree.csv load failed");
      return [];
    }

    const rows = parseCSV(text);
    return rows;
  }

  // tree の構造化（既存ロジックをなるべく壊さない）
  function buildTree(rows) {
    // 先頭行がヘッダーの場合もあるので、ここでは「3列目まで全部空」を弾く程度にしておく
    const cleaned = [];
    for (const r of rows) {
      const l1 = safeText(r[0]);
      const l2 = safeText(r[1]);
      const l3 = safeText(r[2]);
      if (!l1 && !l2 && !l3) continue;
      // ヘッダー（level1/level2/level3）っぽい行は除外
      if (
        l1.toLowerCase() === "level1" &&
        l2.toLowerCase() === "level2" &&
        l3.toLowerCase() === "level3"
      ) {
        continue;
      }
      cleaned.push([l1, l2, l3]);
    }

    // root: { name, children: Map }
    const root = { name: "__root__", children: new Map() };

    function getChild(parent, name) {
      if (!parent.children.has(name)) {
        parent.children.set(name, { name, children: new Map() });
      }
      return parent.children.get(name);
    }

    for (const [l1, l2, l3] of cleaned) {
      const n1 = l1 || "";
      const n2 = l2 || "";
      const n3 = l3 || "";

      if (n1) {
        const c1 = getChild(root, n1);
        if (n2) {
          const c2 = getChild(c1, n2);
          if (n3) {
            getChild(c2, n3);
          }
        }
      }
    }

    return root;
  }

  // =========================================================
  //  Load location.csv（追加カテゴリ）
  // =========================================================
  async function loadLocationCats() {
    let text = null;

    // まず export を試す
    try {
      const r = await fetch(LOCATION_URL_EXPORT, { cache: "no-store" });
      if (r.ok) text = await r.text();
    } catch (_) {}

    // 次に published URL を試す
    if (!text) {
      try {
        const rPub = await fetch(LOCATION_URL_PUBLISHED, { cache: "no-store" });
        if (rPub.ok) text = await rPub.text();
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
      console.warn("[tagfilter] location.csv load failed");
      return { ok: false, reason: "fetch_failed" };
    }

    const rows = parseCSV(text);
    if (!rows || rows.length === 0) {
      return { ok: false, reason: "empty_csv" };
    }

    // 1行目がヘッダーの可能性があるが、ここでは「列数不足」チェックだけする
    const firstData = rows.find((r) => r && r.length > 0) || [];
    if (firstData.length <= LOC_G_INDEX) {
      return { ok: false, reason: "too_few_columns", colCount: firstData.length };
    }

    // G/H を抽出（空白は除外、Gが空の行はスキップ）
    const gToH = new Map();
    const gList = [];

    for (const r of rows) {
      const g = safeText(r[LOC_G_INDEX]);
      const h = safeText(r[LOC_H_INDEX]);

      // 前提：Gが空白の時はHも空白（あなたの説明通り）
      if (!g) continue;

      if (!gToH.has(g)) {
        gToH.set(g, new Set());
        gList.push(g);
      }
      if (h) {
        gToH.get(g).add(h);
      }
    }

    const gSorted = sortJa(uniq(gList));
    return { ok: true, gSorted, gToH };
  }

  // =========================================================
  //  UI render（既存 + 追加カテゴリ）
  // =========================================================
  function clearColumns() {
    const col1 = document.querySelector("#tagCol1");
    const col2 = document.querySelector("#tagCol2");
    const col3 = document.querySelector("#tagCol3");
    if (col1) col1.innerHTML = "";
    if (col2) col2.innerHTML = "";
    if (col3) col3.innerHTML = "";
  }

  function renderColTitle(colElem, title) {
    const h = document.createElement("div");
    h.className = "tag-filter-col-title";
    h.textContent = title;
    colElem.appendChild(h);
  }

  function renderItem(colElem, label, checked, onClick, hasArrow = false) {
    const row = document.createElement("div");
    row.className = "tag-item";
    if (checked) row.classList.add("active");

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!checked;

    const lab = document.createElement("label");
    lab.textContent = label;

    row.appendChild(cb);
    row.appendChild(lab);

    if (hasArrow) {
      const arrow = document.createElement("span");
      arrow.textContent = "›";
      arrow.style.opacity = "0.55";
      arrow.style.marginLeft = "auto";
      row.appendChild(arrow);
    }

    // checkboxクリックでも行クリックと同じ扱いにする
    row.addEventListener("click", (e) => {
      e.preventDefault();
      onClick();
    });

    colElem.appendChild(row);
  }

  // tree col1
  function renderTreeCol1() {
    const col1 = document.querySelector("#tagCol1");
    if (!col1 || !treeRoot) return;

    renderColTitle(col1, "カテゴリ");

    const l1Names = sortJa(Array.from(treeRoot.children.keys()));

    for (const name of l1Names) {
      const isActive = currentL1 === name;
      renderItem(
        col1,
        name,
        isActive,
        () => {
          currentL1 = name;
          currentL2 = null;
          renderAll();
        },
        true
      );
    }

    // ここで追加カテゴリ（G列）を tree の下に「同じ体裁」で並べる
    // titleとして別見出しを出さず、tree項目と同じlistの一部として出す（あなたの希望に合わせる）
    // ただし視認性のため、薄い区切りだけ入れる
    if (locGValues && locGValues.length > 0) {
      const sep = document.createElement("div");
      sep.style.margin = "10px 0 6px";
      sep.style.borderTop = "1px solid rgba(0,0,0,0.08)";
      col1.appendChild(sep);

      for (const g of locGValues) {
        const isActive = selectedLocG === g;
        renderItem(
          col1,
          g,
          isActive,
          () => {
            // tree選択と混ぜない（壊さないため）
            selectedLocG = g;
            selectedLocH = new Set();
            // tree側の currentL1/currentL2 は触らない（既存仕様温存）
            renderAll();
          },
          true
        );
      }
    }
  }

  function renderTreeCol2() {
    const col2 = document.querySelector("#tagCol2");
    if (!col2) return;
    col2.innerHTML = "";

    // 追加カテゴリ（G）が選択されているなら、col2 は H を表示する（あなたの希望）
    if (selectedLocG) {
      renderColTitle(col2, selectedLocG);

      const setH = locGToH.get(selectedLocG);
      const hs = setH ? sortJa(Array.from(setH)) : [];

      if (hs.length === 0) {
        const note = document.createElement("div");
        note.style.fontSize = "12px";
        note.style.opacity = "0.75";
        note.textContent = "（このカテゴリには第2カテゴリがありません）";
        col2.appendChild(note);
        return;
      }

      for (const h of hs) {
        const checked = selectedLocH.has(h);
        renderItem(col2, h, checked, () => {
          if (selectedLocH.has(h)) selectedLocH.delete(h);
          else selectedLocH.add(h);
          renderAll();
        });
      }
      return;
    }

    // 追加カテゴリが選択されていない場合は、従来通り tree の level2 を表示
    renderColTitle(col2, currentL1 ? currentL1 : "（未選択）");
    if (!currentL1) return;

    const node1 = treeRoot.children.get(currentL1);
    if (!node1) return;

    const l2Names = sortJa(Array.from(node1.children.keys()));
    for (const name of l2Names) {
      const isActive = currentL2 === name;
      renderItem(
        col2,
        name,
        isActive,
        () => {
          currentL2 = name;
          renderAll();
        },
        true
      );
    }
  }

  function renderTreeCol3() {
    const col3 = document.querySelector("#tagCol3");
    if (!col3) return;
    col3.innerHTML = "";

    // 追加カテゴリ（G/H）選択中は col3 を空にする（既存UIを壊さず、表示だけ最小）
    if (selectedLocG) {
      renderColTitle(col3, " ");
      return;
    }

    renderColTitle(col3, currentL2 ? currentL2 : "（未選択）");
    if (!currentL1 || !currentL2) return;

    const node1 = treeRoot.children.get(currentL1);
    if (!node1) return;
    const node2 = node1.children.get(currentL2);
    if (!node2) return;

    const l3Names = sortJa(Array.from(node2.children.keys()));
    for (const name of l3Names) {
      const checked = selectedTags.has(name);
      renderItem(col3, name, checked, () => {
        if (selectedTags.has(name)) selectedTags.delete(name);
        else selectedTags.add(name);
        renderAll();
      });
    }
  }

  function renderAll() {
    clearColumns();
    renderTreeCol1();
    renderTreeCol2();
    renderTreeCol3();
    updateApplyState();
  }

  // =========================================================
  //  Apply/Clear（既存を壊さない）
  // =========================================================
  function updateApplyState() {
    const btn = $(BTN_APPLY_ID);
    if (!btn) return;

    const hasTree = selectedTags.size > 0;
    const hasLoc = selectedLocG && selectedLocH.size > 0;

    // “どちらか一方” にしたいならここで制御可能だが、
    // まずは既存を壊さないため「同時選択は許可するが、適用は両方送る」設計にしておく
    btn.disabled = !(hasTree || hasLoc);
  }

  function saveState() {
    try {
      const obj = {
        selectedTags: Array.from(selectedTags),
        selectedLocG: selectedLocG || "",
        selectedLocH: Array.from(selectedLocH),
      };
      localStorage.setItem(STORAGE_KEY_SELECTED_TAGS, JSON.stringify(obj));
    } catch (_) {}
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_SELECTED_TAGS);
      if (!raw) return;
      const obj = JSON.parse(raw);

      selectedTags = new Set(Array.isArray(obj.selectedTags) ? obj.selectedTags : []);
      selectedLocG = safeText(obj.selectedLocG) || null;
      selectedLocH = new Set(Array.isArray(obj.selectedLocH) ? obj.selectedLocH : []);
    } catch (_) {}
  }

  function clearAllSelection() {
    selectedTags = new Set();
    selectedLocG = null;
    selectedLocH = new Set();
    saveState();
    renderAll();
  }

  function applySelection() {
    // 既存の earth 側との連携を壊さないため、
    // 既存で送っていた形式（selectedTags）を維持しつつ、
    // 追加分は別キーで一緒に送るだけにする（earth側が無視しても既存は動く）

    saveState();

    const payload = {
      type: "dd_tag_filter_apply",
      selectedTags: Array.from(selectedTags),
      extra: {
        // 追加カテゴリ（G/H）: G=カテゴリ, H=項目（複数）
        locG: selectedLocG || "",
        locH: Array.from(selectedLocH),
      },
    };

    // 既存：iframe (earth.html) に postMessage
    const frame = document.querySelector("iframe");
    if (frame && frame.contentWindow) {
      frame.contentWindow.postMessage(payload, "*");
    } else {
      // iframeがない場合でも安全に
      window.postMessage(payload, "*");
    }

    // モーダルを閉じる（既存UI維持）
    closeModal();
  }

  // =========================================================
  //  Modal open/close
  // =========================================================
  function openModal() {
    const bd = $(BACKDROP_ID);
    if (!bd) return;
    bd.classList.add("open");
    bd.setAttribute("aria-hidden", "false");

    // 位置調整（既存 index.html のCSSに合わせて中央寄せ）
    const modal = $(MODAL_ID);
    if (modal) {
      // displayはCSSに任せる
    }
  }

  function closeModal() {
    const bd = $(BACKDROP_ID);
    if (!bd) return;
    bd.classList.remove("open");
    bd.setAttribute("aria-hidden", "true");
  }

  // =========================================================
  //  Init
  // =========================================================
  async function init() {
    // 既存DOMがない場合は何もしない
    if (!$(BACKDROP_ID) || !$(MODAL_ID)) return;

    loadState();

    // tree load
    try {
      const rows = await loadTree();
      treeData = rows;
      treeRoot = buildTree(rows);
    } catch (e) {
      console.error("[tagfilter] tree load/build failed", e);
      treeRoot = buildTree([]);
    }

    // location load（追加カテゴリ）
    try {
      const loc = await loadLocationCats();
      if (!loc.ok) {
        // 既存 tree は動かし続けるため、ここでは “表示だけ” メッセージに留める
        if (loc.reason === "too_few_columns") {
          // これは “公開CSVにG/H列が存在しない” ことを意味する
          // ※UIは壊さず、第一カラム末尾にメッセージだけ出す
          locGValues = [];
          locGToH = new Map();
          // render後に入れるため一旦フラグで保持
          window.__dd_loc_col_warning__ =
            "location.csv の列数が想定より少ないため、G/H を読み取れません（公開CSVに G/H が含まれているか確認してください）";
        } else {
          locGValues = [];
          locGToH = new Map();
        }
      } else {
        locGValues = loc.gSorted;
        locGToH = loc.gToH;
      }
    } catch (e) {
      console.warn("[tagfilter] location load failed", e);
      locGValues = [];
      locGToH = new Map();
    }

    // 初期描画
    renderAll();

    // warning表示（col1末尾）
    if (window.__dd_loc_col_warning__) {
      setNoticeInFirstColumn(window.__dd_loc_col_warning__);
      delete window.__dd_loc_col_warning__;
    }

    // bind buttons
    const btnOpen = $(BTN_OPEN_ID);
    if (btnOpen) btnOpen.addEventListener("click", openModal);

    const btnClose = $(BTN_CLOSE_ID);
    if (btnClose) btnClose.addEventListener("click", closeModal);

    const btnClear = $(BTN_CLEAR_ID);
    if (btnClear) btnClear.addEventListener("click", clearAllSelection);

    const btnApply = $(BTN_APPLY_ID);
    if (btnApply) btnApply.addEventListener("click", applySelection);

    // backdrop click to close（モーダル外を押したら閉じる）
    const bd = $(BACKDROP_ID);
    if (bd) {
      bd.addEventListener("click", (e) => {
        if (e.target === bd) closeModal();
      });
    }

    // Esc to close
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });
  }

  // DOM ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
