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

  const btn = document.getElementById("tagFilterBtn");
  const badge = document.getElementById("tagFilterCount");

  const backdrop = document.getElementById("tagFilterBackdrop");
  const modal = backdrop ? backdrop.querySelector(".tag-filter-modal") : null;
  const closeBtn = document.getElementById("tagFilterClose");

  // ★ index.html に無い可能性があるので「任意」にする
  const applyBtn = document.getElementById("tagFilterApply");
  const clearBtn = document.getElementById("tagFilterClear");

  const colWrap = document.getElementById("tagFilterColumns");
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

  // selection state
  let selected = new Set(); // Set<nodeId>
  let path = []; // currently opened path (ids per depth)
  const MAX_DEPTH = 3;

  // 自動適用（リロード時に earth 側へ再送）
  let hadSavedSelection = false;
  let treeReady = false;
  let earthReady = false;
  let autoApplied = false;

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

  function csvParseLine(line) {
    // simple CSV parse (handles quoted)
    const out = [];
    let cur = "";
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            q = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') q = true;
        else if (ch === ",") {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function ensureNode(id, labelText, depth, parentId) {
    if (!nodesById.has(id)) {
      const node = { id, label: labelText, depth, parentId, children: new Set() };
      nodesById.set(id, node);
      label.set(id, labelText);
      parent.set(id, parentId);
      depthById.set(id, depth);

      if (!childrenByParent.has(parentId)) childrenByParent.set(parentId, new Set());
      childrenByParent.get(parentId).add(id);
    }
    // parent children link
    const p = nodesById.get(parentId);
    if (p) p.children.add(id);
  }

  function getDescendants(id) {
    const out = [];
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      const ch = childrenByParent.get(cur);
      if (!ch) continue;
      ch.forEach((cid) => {
        out.push(cid);
        stack.push(cid);
      });
    }
    return out;
  }

  function setNodeAndDescendants(id, on) {
    if (on) {
      selected.add(id);
      getDescendants(id).forEach((d) => selected.add(d));
    } else {
      selected.delete(id);
      getDescendants(id).forEach((d) => selected.delete(d));
    }
  }

  function computeIndeterminateStates() {
    // returns { checked:Set, indeterminate:Set }
    const checked = new Set(selected);
    const ind = new Set();

    // post-order by depth (deep -> shallow)
    const nodes = Array.from(nodesById.values()).sort((a, b) => b.depth - a.depth);
    nodes.forEach((node) => {
      const ch = childrenByParent.get(node.id);
      if (!ch || ch.size === 0) return;

      let allOn = true;
      let anyOn = false;
      ch.forEach((cid) => {
        if (checked.has(cid)) anyOn = true;
        else allOn = false;
        if (ind.has(cid)) anyOn = true;
      });

      if (allOn) {
        checked.add(node.id);
        ind.delete(node.id);
      } else if (anyOn) {
        checked.delete(node.id);
        ind.add(node.id);
      } else {
        checked.delete(node.id);
        ind.delete(node.id);
      }
    });

    return { checked, indeterminate: ind };
  }

  function saveSelection() {
    try {
      const arr = Array.from(selected);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(arr));
    } catch (_) {}
  }

  function loadSelection() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        hadSavedSelection = false;
        selected = new Set();
        return;
      }
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length > 0) {
        hadSavedSelection = true;
        selected = new Set(arr.filter((x) => typeof x === "string"));
      } else {
        hadSavedSelection = false;
        selected = new Set();
      }
    } catch (_) {
      hadSavedSelection = false;
      selected = new Set();
    }
  }

  function setBadge() {
    // (0) 表示を維持
    try {
      badge.textContent = `(${selected.size})`;
    } catch (_) {}
  }

  // ----------------------------
  //  Render columns
  // ----------------------------
  function clearColumns() {
    colWrap.innerHTML = "";
  }

  function createColumn(titleText) {
    const col = document.createElement("div");
    col.className = "tag-filter-col";

    const h = document.createElement("div");
    h.className = "tag-filter-col-title";
    h.textContent = titleText;

    col.appendChild(h);
    return col;
  }

  function renderList(colEl, parentId, depth, checked, indeterminate) {
    if (!parentId) return;

    const ch = childrenByParent.get(parentId);
    if (!ch || ch.size === 0) return;

    // sort by label
    const arr = Array.from(ch)
      .map((id) => nodesById.get(id))
      .filter(Boolean);
    arr.sort((a, b) => (a.label || "").localeCompare((b.label || ""), "ja"));

    arr.forEach((node) => {
      const row = document.createElement("div");
      row.className = "tag-item";
      if (path[depth - 1] === node.id) row.classList.add("active");

      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = checked.has(node.id);
      cb.indeterminate = indeterminate.has(node.id);

      const lab = document.createElement("label");
      lab.textContent = node.label;

      const chev = document.createElement("div");
      chev.style.opacity = "0.5";
      chev.style.marginLeft = "auto";
      const hasKids =
        childrenByParent.get(node.id) && childrenByParent.get(node.id).size > 0;
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
    cols.push(col1);

    const l1 = path[0] || null;
    const col2 = createColumn(l1 ? label.get(l1) || " " : " ");
    renderList(col2, l1, 2, checked, indeterminate);
    cols.push(col2);

    const l2 = path[1] || null;
    const col3 = createColumn(l2 ? label.get(l2) || " " : " ");
    renderList(col3, l2, 3, checked, indeterminate);
    cols.push(col3);

    cols.forEach((c) => colWrap.appendChild(c));

    // ★ clearBtn が存在する時だけ制御（無ければ何もしない）
    if (clearBtn) {
      if (selected.size > 0) {
        clearBtn.style.display = "";
        clearBtn.removeAttribute("aria-hidden");
        clearBtn.removeAttribute("tabindex");
      } else {
        clearBtn.style.display = "none";
        clearBtn.setAttribute("aria-hidden", "true");
        clearBtn.setAttribute("tabindex", "-1");
      }
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
    backdrop.setAttribute("aria-hidden", "false");
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
    backdrop.classList.remove("open");
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

    for (let i = 1; i < lines.length; i++) {
      const cols = csvParseLine(lines[i]);
      const l1 = normalize(cols[idx1]);
      const l2 = normalize(cols[idx2]);
      const l3 = normalize(cols[idx3]);

      if (!l1) continue;

      const id1 = "L1:" + l1;
      ensureNode(id1, l1, 1, ROOT_ID);

      if (l2) {
        const id2 = "L2:" + l1 + ">" + l2;
        ensureNode(id2, l2, 2, id1);

        if (l3) {
          const id3 = "L3:" + l1 + ">" + l2 + ">" + l3;
          ensureNode(id3, l3, 3, id2);
        }
      }
    }
  }

  async function loadTree() {
    treeReady = false;
    renderColumns();

    let csv = null;
    try {
      csv = await fetchCsv(TREE_URL_PRIMARY);
    } catch (e1) {
      try {
        csv = await fetchCsv(TREE_URL_FALLBACK);
      } catch (e2) {
        csv = null;
      }
    }

    if (!csv) {
      treeReady = true;
      clearColumns();
      const msg = document.createElement("div");
      msg.style.padding = "10px";
      msg.style.opacity = "0.9";
      msg.textContent = "タグ一覧の読み込みに失敗しました（CSV）。";
      colWrap.appendChild(msg);
      return;
    }

    buildTreeFromCsv(csv);
    treeReady = true;
    renderColumns();
    tryAutoApply();
  }

  // ----------------------------
  //  Init
  // ----------------------------
  loadSelection();
  setBadge();
  loadTree();
})();
