(function () {
  // ----------------------------
  //  Tag Filter (Tree / Columns)
  // ----------------------------
  const STORAGE_KEY = "dd_selected_tags_v1";

  // 言語取得
  function getStoredLang() {
    const LANG_KEYS = [
      "lang",
      "dd_lang",
      "language",
      "ddLang",
      "ddLanguage",
      "selectedLang",
      "selectedLanguage",
      "i18n_lang",
      "i18nextLng"
    ];

    try {
      for (const k of LANG_KEYS) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;

        const low = String(raw).trim().toLowerCase();
        if (!low) continue;

        const base = low.split("-")[0];
        if (["ja", "en", "zh", "hi", "he", "fa"].includes(base)) {
          return base;
        }
      }
    } catch (_) {}

    return "ja";
  }

  function getTreeUrlPrimaryByLang(lang) {
    const map = {
      ja: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv",
      en: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=191705455&single=true&output=csv",
      zh: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=1744467585&single=true&output=csv",
      hi: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=1976865856&single=true&output=csv",
      he: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=1609603534&single=true&output=csv",
      fa: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=772346125&single=true&output=csv"
    };

    return map[lang] || map.ja;
  }

  // フォールバック（同梱tree.csvがある場合）
  const TREE_URL_FALLBACK = "./tree.csv";

  const CURRENT_LANG = getStoredLang();
  const TREE_URL_PRIMARY = getTreeUrlPrimaryByLang(CURRENT_LANG);

  // ★追加: location.csv（G/Hを追加カテゴリに使う）
  function getLocationUrlPrimaryByLang(lang) {
    const map = {
      ja: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=717261533&single=true&output=csv",
      en: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=876416218&single=true&output=csv",
      zh: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=1151530563&single=true&output=csv",
      hi: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=1154641933&single=true&output=csv",
      he: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=117898032&single=true&output=csv",
      fa: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=690009794&single=true&output=csv"
    };

    return map[lang] || map.ja;
  }

  const UI_TEXT = {
    ja: {
      filter: "絞り込み",
      category: "カテゴリ",
      apply: "適用",
      clear: "クリア",
      loading: "読み込み中…",
      noExtraCategories: "追加カテゴリがありません",
      chooseFirstCategory: "第1カテゴリを選択してください",
      noSecondCategory: "第2カテゴリはありません",
      loadError: "location.csv を読み込めませんでした（URL/gid を確認してください）",
      emptyCsv: "location.csv が空です",
      missingColumns: "location.csv の列数が想定より少ないため、H/I を読み取れません（公開CSVにH/Iが含まれているか確認してください）"
    },
    en: {
      filter: "Filter",
      category: "Category",
      apply: "Apply",
      clear: "Clear",
      loading: "Loading…",
      noExtraCategories: "No extra categories",
      chooseFirstCategory: "Please choose the first category",
      noSecondCategory: "No second category",
      loadError: "Could not load location.csv (please check the URL/gid).",
      emptyCsv: "location.csv is empty",
      missingColumns: "location.csv has fewer columns than expected, so H/I could not be read."
    },
    zh: {
      filter: "筛选",
      category: "分类",
      apply: "应用",
      clear: "清除",
      loading: "加载中…",
      noExtraCategories: "没有附加分类",
      chooseFirstCategory: "请选择第一分类",
      noSecondCategory: "没有第二分类",
      loadError: "无法加载 location.csv（请检查 URL/gid）",
      emptyCsv: "location.csv 为空",
      missingColumns: "location.csv 的列数少于预期，因此无法读取 H/I。"
    },
    hi: {
      filter: "फ़िल्टर",
      category: "श्रेणी",
      apply: "लागू करें",
      clear: "साफ़ करें",
      loading: "लोड हो रहा है…",
      noExtraCategories: "कोई अतिरिक्त श्रेणी नहीं है",
      chooseFirstCategory: "कृपया पहली श्रेणी चुनें",
      noSecondCategory: "दूसरी श्रेणी नहीं है",
      loadError: "location.csv लोड नहीं किया जा सका (कृपया URL/gid जाँचें)।",
      emptyCsv: "location.csv खाली है",
      missingColumns: "location.csv में अपेक्षा से कम कॉलम हैं, इसलिए H/I नहीं पढ़ा जा सका।"
    },
    he: {
      filter: "סינון",
      category: "קטגוריה",
      apply: "החל",
      clear: "נקה",
      loading: "טוען…",
      noExtraCategories: "אין קטגוריות נוספות",
      chooseFirstCategory: "נא לבחור את הקטגוריה הראשונה",
      noSecondCategory: "אין קטגוריה שנייה",
      loadError: "לא ניתן לטעון את location.csv (נא לבדוק את ה-URL/gid).",
      emptyCsv: "location.csv ריק",
      missingColumns: "ב-location.csv יש פחות עמודות מהצפוי, לכן לא ניתן לקרוא את H/I."
    },
    fa: {
      filter: "فیلتر",
      category: "دسته‌بندی",
      apply: "اعمال",
      clear: "پاک کردن",
      loading: "در حال بارگذاری…",
      noExtraCategories: "دسته‌بندی اضافی وجود ندارد",
      chooseFirstCategory: "لطفاً دسته‌بندی اول را انتخاب کنید",
      noSecondCategory: "دسته‌بندی دوم وجود ندارد",
      loadError: "بارگذاری location.csv انجام نشد (URL/gid را بررسی کنید).",
      emptyCsv: "location.csv خالی است",
      missingColumns: "تعداد ستون‌های location.csv کمتر از حد انتظار است، بنابراین H/I خوانده نشد."
    }
  };

  function t(key) {
    const dict = UI_TEXT[CURRENT_LANG] || UI_TEXT.ja;
    return dict[key] || (UI_TEXT.ja[key] || key);
  }

  function applyStaticTexts() {
    try {
      if (btn) {
        btn.innerHTML = `${t("filter")} <span id="tagFilterCount" class="tag-filter-count">(${selected.size})</span>`;
      }

      const modalTitle =
        document.getElementById("tagFilterTitle") ||
        document.getElementById("modalTitle");
      if (modalTitle) {
        modalTitle.textContent = t("filter");
      }

      if (applyBtn) applyBtn.textContent = t("apply");
      if (clearBtn) clearBtn.textContent = t("clear");

      const colTitles = document.querySelectorAll(".tag-filter-col-title, .column h3");
      colTitles.forEach((el) => {
        if ((el.textContent || "").trim() === "カテゴリ" || el.dataset.role === "category-title") {
          el.textContent = t("category");
          el.dataset.role = "category-title";
        }
      });
    } catch (e) {
      console.warn("[tagfilter] applyStaticTexts error:", e);
    }
  }

  const LOCATION_URL_PRIMARY = getLocationUrlPrimaryByLang(CURRENT_LANG);
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

  // 既存: 追加カテゴリ表示用コンテナ（1つだけ置いてある想定）
  // 今回: 第1カテゴリ(G)はこの要素に表示、 第2カテゴリ(H)はJS側で別要素を生成して第2カラムへ移動
  const locAreaG = document.getElementById("tagFilterLocArea");
  let locAreaH = document.getElementById("tagFilterLocArea2");

  const iframe = document.getElementById("webxr-iframe");

  // ★ 必須要素だけチェック（apply/clear/locArea は無くても動かす）
  if (!btn || !badge || !backdrop || !modal || !closeBtn || !colWrap || !iframe) {
    return;
  }

  applyStaticTexts();

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
    // minimal CSV parser (handles quotes in a single logical record)
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

  function parseCsvRecords(text) {
    // 改行を含む quoted field に対応したCSVパーサ
    // 返り値: 2次元配列 rows[rowIndex][colIndex]
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
        continue;
      }

      if (ch === '"') {
        inQ = true;
        continue;
      }

      if (ch === ",") {
        row.push(cur);
        cur = "";
        continue;
      }

      if (ch === "\n") {
        row.push(cur);
        cur = "";
        if (row.some((v) => String(v).length > 0)) rows.push(row);
        row = [];
        continue;
      }

      if (ch === "\r") {
        // CRLF の CR は無視（LF 側で行確定）
        continue;
      }

      cur += ch;
    }

    if (cur.length > 0 || row.length > 0) {
      row.push(cur);
      if (row.some((v) => String(v).length > 0)) rows.push(row);
    }

    return rows;
  }

  function ensureSet(map, key) {
    if (!map.has(key)) map.set(key, new Set());
    return map.get(key);
  }

  // ----------------------------
  //  location.csv(G/H) -> extra category UI
  // ----------------------------
  // ★ 追加タグ開始列は H/I 固定（0始まりで 7/8）
  const LOC_G_INDEX = 7;
  const LOC_H_INDEX = 8;

  let locReady = false;
  let locGList = []; // ["有名な場所", "有名な物", ...]
  let locChildren = new Map(); // G -> Set(H)
  let locOpenG = null; // 第1カテゴリで現在選択（開いている）G
  let locDebugMessage = ""; // 表示だけ（壊さない）

  function ensureLocAreaHExists() {
    if (locAreaH) return locAreaH;
    locAreaH = document.createElement("div");
    locAreaH.id = "tagFilterLocArea2";
    return locAreaH;
  }

  async function loadLocationCats() {
    if (!locAreaG) {
      // index.html に locArea が無い構成でも落とさない
      locReady = false;
      return;
    }

    console.log("[tagfilter] CURRENT_LANG =", CURRENT_LANG);
    console.log("[tagfilter] TREE_URL_PRIMARY =", TREE_URL_PRIMARY);
    console.log("[tagfilter] LOCATION_URL_PRIMARY =", LOCATION_URL_PRIMARY);

    let text = "";
    locDebugMessage = "";

    // Primary（Google Sheets CSV）
    // ★公開CSVが「使用範囲が狭い(A〜Eだけ等)」として出力される場合、G/H以降が落ちることがあります。
    // その場合に備えて range 付きも順に試します（仕様はH/I固定のまま）。
    const locPrimaryCandidates = [
      LOCATION_URL_PRIMARY,
      LOCATION_URL_PRIMARY + "&range=A:L",
      LOCATION_URL_PRIMARY + "&range=A:Z",
    ];

    for (const u of locPrimaryCandidates) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (!r.ok) continue;
        const t = await r.text();
        if (t && t.trim().length > 0) {
          text = t;
          break;
        }
      } catch (_) {}
    }

    // Fallback（同階層の location.csv）
    if (!text) {
      try {
        const r2 = await fetch(LOCATION_URL_FALLBACK, { cache: "no-store" });
        if (r2.ok) text = await r2.text();
      } catch (_) {}
    }

    if (!text) {
      locReady = false;
      locDebugMessage = t("loadError");
      renderLocAreas();
      return;
    }

    const rows = parseCsvRecords(text);
    if (!rows.length) {
      locReady = false;
      locDebugMessage = t("emptyCsv");
      renderLocAreas();
      return;
    }

    // ヘッダー判定（2列目/3列目が数値でないならヘッダー扱い）
    let start = 0;
    try {
      const head = rows[0] || [];
      const lat = parseFloat((head[2] || "").replace(/[−–‐]/g, "-"));
      const lng = parseFloat((head[3] || "").replace(/[−–‐]/g, "-"));
      if (isNaN(lat) || isNaN(lng)) start = 1;
    } catch (_) {}

    const gSet = new Set();
    const childMap = new Map();

    // 列数不足チェック（最低でもIまで必要）
    try {
      const firstData = rows[Math.min(start, rows.length - 1)] || [];
      if (firstData.length <= LOC_H_INDEX) {
        locDebugMessage = t("missingColumns");
      }
    } catch (_) {}

    for (let i = start; i < rows.length; i++) {
      const parts = rows[i] || [];

      // 行ごとに列数が足りない場合はスキップ
      if (!parts || parts.length <= LOC_G_INDEX) continue;

      const g = normalize(parts[LOC_G_INDEX]);
      const h = parts.length > LOC_H_INDEX ? normalize(parts[LOC_H_INDEX]) : "";

      if (!g) continue;

      gSet.add(g);
      if (!childMap.has(g)) childMap.set(g, new Set());
      if (h) childMap.get(g).add(h);

      label.set("loc::g::" + g, g);
      if (h) label.set("loc::h::" + g + "::" + h, h);
    }

    locGList = Array.from(gSet).sort((a, b) => a.localeCompare(b, "ja"));
    locChildren = childMap;
    locOpenG = locOpenG && childMap.has(locOpenG) ? locOpenG : null;

    locReady = true;
    renderLocAreas();
  }

  // 第1カテゴリ（G）: 第1カラムに表示
  // 第2カテゴリ（H）: 第1カテゴリ選択時に第2カラムに表示
  function renderLocAreas() {
    if (!locAreaG) return;

    // --- G（第1） ---
    locAreaG.innerHTML = "";
    locAreaG.style.marginTop = "10px";

    // 「追加カテゴリ（第1）」は表示しない（要望）
    // ただしデバッグ表示は壊さない範囲で残す
    if (locDebugMessage) {
      const msg0 = document.createElement("div");
      msg0.style.opacity = "0.65";
      msg0.style.padding = "6px 2px";
      msg0.style.fontSize = "12px";
      msg0.textContent = locDebugMessage;
      locAreaG.appendChild(msg0);
    }

    if (!locReady) {
      const msg = document.createElement("div");
      msg.style.opacity = "0.7";
      msg.style.padding = "6px 2px";
      msg.textContent = t("loading");
      locAreaG.appendChild(msg);
      // H側も空にしておく
      const hArea = ensureLocAreaHExists();
      hArea.innerHTML = "";
      return;
    }

    if (!locGList.length) {
      const msg = document.createElement("div");
      msg.style.opacity = "0.7";
      msg.style.padding = "6px 2px";
      msg.textContent = t("noExtraCategories");
      locAreaG.appendChild(msg);
    } else {
      // G一覧（クリックで H を切替、チェックで選択）
      locGList.forEach((g) => {
        const id = "loc::g::" + g;
        const row = makeLocGRow(id, g);
        locAreaG.appendChild(row);
      });
    }

    // --- H（第2） ---
    const hArea = ensureLocAreaHExists();
    hArea.innerHTML = "";
    hArea.style.marginTop = "10px";

    // ★要望: 追加カテゴリのタイトルは不要なので表示しない（ここでは見出しを作らない）

    if (!locOpenG) {
      const msg = document.createElement("div");
      msg.style.opacity = "0.7";
      msg.style.padding = "6px 2px";
      msg.textContent = t("chooseFirstCategory");
      hArea.appendChild(msg);
      return;
    }

    const setH = locChildren.get(locOpenG) || new Set();
    const list = Array.from(setH).sort((a, b) => a.localeCompare(b, "ja"));

    if (!list.length) {
      const msg = document.createElement("div");
      msg.style.opacity = "0.7";
      msg.style.padding = "6px 2px";
      msg.textContent = t("noSecondCategory");
      hArea.appendChild(msg);
      return;
    }

    list.forEach((h) => {
      const id = "loc::h::" + locOpenG + "::" + h;
      const row = makeLocHRow(id, h);
      hArea.appendChild(row);
    });
  }

  function makeLocGRow(id, text) {
    const row = document.createElement("div");
    row.className = "node";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selected.has(id);

    // ★既存カテゴリ（tree）と同様に「子が一部だけ選択されている」状態を
    //  第1カテゴリ（G）側のチェックボックスに反映（いわゆる「ー」表示）
    //  ※loc(G/H)は木構造(nodesById)とは別管理なので、ここで計算する
    try {
      const kids = locChildren.get(text) || new Set();
      if (kids && kids.size > 0) {
        let any = false;
        let all = true;
        kids.forEach((h) => {
          const hid = "loc::h::" + text + "::" + h;
          const on = selected.has(hid);
          any = any || on;
          all = all && on;
        });

        // 親(G)自体が未チェックでも子が選ばれていれば indeterminate にする
        // 親がチェック済みでも子が全て揃っていなければ indeterminate
        cb.indeterminate = (any && !all) || (any && !cb.checked);
      } else {
        cb.indeterminate = false;
      }
    } catch (_) {
      cb.indeterminate = false;
    }

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

      const kids = locChildren.get(text) || new Set();
      kids.forEach((h) => {
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

  function makeLocHRow(id, text) {
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
    chev.textContent = "";

    row.appendChild(cb);
    row.appendChild(lab);
    row.appendChild(chev);

    cb.addEventListener("click", (e) => {
      e.stopPropagation();
      const on = cb.checked;
      if (on) selected.add(id);
      else selected.delete(id);

      // ★第2カテゴリ(H)のみを選んだ場合でも、
      //  第1カテゴリ(G)側に「一部選択」マーク（indeterminate）が出るように更新
      //  （renderColumns() 内で renderLocAreas() が呼ばれるため、
      //   ここでは locOpenG を維持するだけでOK）

      saveSelection();
      setBadge();
      renderColumns();
      schedulePostSelected();
    });

    return row;
  }

  function setBadge() {
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
    if (on) selected.add(nodeId);
    else selected.delete(nodeId);

    const kids = childrenByParent.get(nodeId);
    if (!kids) return;
    kids.forEach((k) => setNodeAndDescendants(k, on));
  }

  function computeIndeterminateStates() {
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
        all = false;
      }

      if (selfChecked) checked.add(nodeId);
      if (any && !all) indeterminate.add(nodeId);
      return { any, all };
    }

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
    if (title && String(title).trim().length > 0) {
      const h = document.createElement("h3");
      h.textContent = title || "";
      col.appendChild(h);
    }
    return col;
  }

  function renderList(colEl, parentId, checked, indeterminate) {
    if (!parentId) return;

    const kids = getChildren(parentId)
      .map((id) => nodesById.get(id))
      .filter(Boolean);

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
        saveSelection();
        setBadge();
        renderColumns();
        schedulePostSelected();
      });

      row.addEventListener("click", () => {
        // ★重要: 既存カテゴリ側をクリックしたら、追加カテゴリの表示モードを解除する
        locOpenG = null;

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
      msg.textContent = t("loading");
      colWrap.appendChild(msg);
      return;
    }

    const { checked, indeterminate } = computeIndeterminateStates();

    const col1 = createColumn(t("category"));
    renderList(col1, ROOT_ID, checked, indeterminate);

    // 第1カテゴリ（G）: 第1カラムに表示（見出しは消す）
    if (locAreaG) {
      if (locAreaG.parentNode) locAreaG.parentNode.removeChild(locAreaG);
      locAreaG.classList.add("loc-area-in-col1");
      col1.appendChild(locAreaG);
    }

    const l1 = path[0] || null;

    // ★要望: 追加カテゴリを表示しているときは「タイトルを表示しない」
    const col2Title = locOpenG ? "" : (l1 ? label.get(l1) || " " : " ");
    const col2 = createColumn(col2Title);

    if (!locOpenG) {
      // 既存カテゴリの第2カラム
      renderList(col2, l1, checked, indeterminate);
    } else {
      // 追加カテゴリの第2カラム（専用表示）
      const hArea = ensureLocAreaHExists();
      if (hArea.parentNode) hArea.parentNode.removeChild(hArea);
      hArea.classList.add("loc-area-in-col2");
      col2.appendChild(hArea);
    }

    // 第3カラムは「追加カテゴリ表示中」は空にする
    const l2 = (!locOpenG) ? (path[1] || null) : null;
    const showL2 = l2 && nodeHasChildren(l2);
    const col3 = createColumn(showL2 ? label.get(l2) || " " : " ");
    renderList(col3, showL2 ? l2 : null, checked, indeterminate);

    colWrap.appendChild(col1);
    colWrap.appendChild(col2);
    colWrap.appendChild(col3);

    // 追加カテゴリのUIもここで再描画（配置先が変わるため）
    if (locAreaG) {
      renderLocAreas();
    }

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
    const ids = Array.from(selected).filter((id) => {
      if (!id || id === ROOT_ID || id === EMPTY_ID) return false;

      const n = nodesById.get(id);
      if (n) {
        // tree.csv 側は親カテゴリを送らず leaf のみ送る
        return !(n.children && n.children.size > 0);
      }

      // 追加カテゴリ loc(G/H) の扱い
      if (id.startsWith("loc::g::")) {
        const g = id.slice("loc::g::".length);
        const kids = locChildren.get(g) || new Set();

        // H が1つでも選ばれているなら、Gは送らない
        // これで「盛りだくさん」+「インドのベストシーン集」が同時送信されず、
        // OR 条件で別行まで混ざる問題を防ぐ
        for (const h of kids) {
          const hid = "loc::h::" + g + "::" + h;
          if (selected.has(hid)) return false;
        }

        // Hが無いG、またはG単独選択の時だけ送る
        return true;
      }

      if (id.startsWith("loc::h::")) {
        return true;
      }

      // label が無い不明IDは送らない
      return label.has(id);
    });

    const tags = ids
      .map((id) => label.get(id))
      .map((s) => (s == null ? "" : String(s).trim()))
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

    // ★重要: 選択IDの label が揃うまで待つ（起動直後の一瞬でIDが送られるのを防ぐ）
    const unresolved = Array.from(selected).some((id) => !label.has(id));
    if (unresolved) {
      // 少し待って再試行（短時間で揃う想定）
      setTimeout(tryAutoApply, 50);
      return;
    }

    autoApplied = true;
    postSelected();
  }

  window.addEventListener("message", (ev) => {
    const data = ev && ev.data;
    if (!data || typeof data !== "object") return;
    if (data.type === "dd-earth-ready") {
      console.log("[tagfilter] got dd-earth-ready");
      earthReady = true;
      tryAutoApply();
    }
  });

  // ----------------------------
  //  Modal open/close
  // ----------------------------
  function openModal() {
    backdrop.style.display = "flex";
    backdrop.setAttribute("aria-hidden", "false");
    btn.setAttribute("aria-expanded", "true");
    backdrop.classList.add("open");

    document.body.style.overflow = "hidden";

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
      } finally {
        modal.style.visibility = "visible";
      }
    });

    renderColumns();
  }

  function closeModal() {
    backdrop.setAttribute("aria-hidden", "true");
    btn.setAttribute("aria-expanded", "false");
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

  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) closeModal();
  });

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

    const rows = parseCsvRecords(csvText);
    if (rows.length <= 1) return;

    const header = (rows[0] || []).map((s) => normalize(s).toLowerCase());
    const idx1 = header.indexOf("level1");
    const idx2 = header.indexOf("level2");
    const idx3 = header.indexOf("level3");
    if (idx1 < 0) return;

    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i] || [];
      const l1 = normalize(cols[idx1]);
      const l2 = idx2 >= 0 ? normalize(cols[idx2]) : "";
      const l3 = idx3 >= 0 ? normalize(cols[idx3]) : "";

      if (!l1) continue;

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
    } catch (e) {
      console.warn("[tagfilter] failed to load TREE_URL_PRIMARY:", TREE_URL_PRIMARY, e);
    }

    try {
      const csv = await fetchCsv(TREE_URL_FALLBACK);
      buildTreeFromCsv(csv);
      treeReady = true;
      await loadLocationCats();
      renderColumns();
      tryAutoApply();
    } catch (e2) {
      console.warn("[tagfilter] failed to load TREE_URL_FALLBACK:", TREE_URL_FALLBACK, e2);
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