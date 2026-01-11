/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 *   Cloudflare Worker の /chat に POST し、reply と nextState を表示・保持する。
 * - nextState は recommend.js 側で保持し、次回リクエストに同梱（ステートレス設計）。
 * - エラー（ネットワーク/JSON/HTTP非2xx）は画面に表示。
 * - debug（ALLOW_DEBUG=1 のとき）は console に出す（必要なら window にも退避）。
 */
(() => {
  "use strict";

  // =========================================================
  // 1) 設定（ここだけ最初に調整）
  // =========================================================
  // 例: "https://lucy-recommend.awachima7.workers.dev/chat"
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

  // state 永続化（任意）
  const STORAGE_KEY_STATE = "dd_recommend_next_state_v1";
  const STORAGE_KEY_CHAT  = "dd_recommend_chat_log_v1"; // 画面ログを軽く残す（任意）

  // 画面ログの最大保持（重くならないように）
  const MAX_LOG_LINES = 60;

  // =========================================================
  // 2) DOM取得（既存UIを利用）
  // =========================================================
  const inputEl = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatEl  = document.getElementById("recommendChat");

  // touristInfoBtn / recommendSection は「あるなら」連携（無くても動く）
  const touristInfoBtn = document.getElementById("touristInfoBtn");
  const recommendSection = document.getElementById("recommendSection");

  if (!inputEl || !sendBtn || !chatEl) {
    // 既存UIが無い場合は何もしない（今回は index.html にある前提）
    console.warn("[recommend.js] Required DOM not found. (#recommendInput/#recommendSend/#recommendChat)");
    return;
  }

  // =========================================================
  // 3) 内部状態（nextState を保持）
  // =========================================================
  let nextState = null;

  // =========================================================
  // 4) ユーティリティ
  // =========================================================
  function safeJsonParse(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: e }; }
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_STATE);
      if (!raw) return null;
      const parsed = safeJsonParse(raw);
      return parsed.ok && parsed.value && typeof parsed.value === "object" ? parsed.value : null;
    } catch (_) {
      return null;
    }
  }

  function saveState(stateObj) {
    try {
      if (!stateObj) {
        localStorage.removeItem(STORAGE_KEY_STATE);
        return;
      }
      localStorage.setItem(STORAGE_KEY_STATE, JSON.stringify(stateObj));
    } catch (_) {}
  }

  function loadChatLog() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_CHAT);
      if (!raw) return [];
      const parsed = safeJsonParse(raw);
      return parsed.ok && Array.isArray(parsed.value) ? parsed.value : [];
    } catch (_) {
      return [];
    }
  }

  function saveChatLog(lines) {
    try {
      localStorage.setItem(STORAGE_KEY_CHAT, JSON.stringify(lines.slice(-MAX_LOG_LINES)));
    } catch (_) {}
  }

  function setSending(isSending) {
    sendBtn.disabled = !!isSending;
    inputEl.disabled = !!isSending;
    if (isSending) {
      sendBtn.dataset._prevText = sendBtn.textContent || "";
      sendBtn.textContent = "送信中…";
    } else {
      const prev = sendBtn.dataset._prevText;
      if (typeof prev === "string" && prev.length) sendBtn.textContent = prev;
      delete sendBtn.dataset._prevText;
    }
  }

  function appendLine(line) {
    const current = (chatEl.textContent || "").split("\n").filter(Boolean);
    current.push(line);
    const clipped = current.slice(-MAX_LOG_LINES);
    chatEl.textContent = clipped.join("\n");
    chatEl.scrollTop = chatEl.scrollHeight;
    saveChatLog(clipped);
  }

  function appendUser(text) {
    appendLine(`You: ${text}`);
  }

  function appendLucy(text) {
    appendLine(`Lucy: ${text}`);
  }

  function appendError(title, detail) {
    const msg = detail ? `${title}\n${detail}` : title;
    appendLine(`[ERROR] ${msg}`);
  }

  function normalizeUserText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  // =========================================================
  // 5) 初期化（復元）
  // =========================================================
  // ボタン文言（既存の「近日公開」表記を崩さず、実運用では差し替え）
  // ※完全に変えたくなければ、下2行をコメントアウトしてください。
  if ((sendBtn.textContent || "").includes("近日公開")) {
    sendBtn.textContent = "質問する";
  }

  // state復元
  nextState = loadState();

  // 画面ログ復元（任意）
  const savedLines = loadChatLog();
  if (savedLines.length) {
    chatEl.textContent = savedLines.join("\n");
    chatEl.scrollTop = chatEl.scrollHeight;
  } else {
    // 初回は軽い案内を入れても良いが、既存デザインを尊重して何も入れない
  }

  // touristInfoBtn で recommendSection を開閉している既存実装がある可能性があるので、
  // recommend.js 側では「邪魔しない」方針：追加のトグルはしない。
  // ただし、送信時にパネルが閉じていたら開くだけ（控えめに補助）
  function ensurePanelOpenSoftly() {
    if (!recommendSection) return;
    if (recommendSection.classList.contains("is-collapsed")) {
      recommendSection.classList.remove("is-collapsed");
      if (touristInfoBtn) touristInfoBtn.setAttribute("aria-expanded", "true");
    }
  }

  // =========================================================
  // 6) Worker呼び出し本体
  // =========================================================
  async function callWorker(userText) {
    const payload = { userText: userText };
    // 初回は state を送らない（null or 省略）
    if (nextState && typeof nextState === "object") {
      payload.state = nextState;
    }

    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    // 非2xxでも body を読んでユーザーに出す
    const rawText = await res.text().catch(() => "");
    const parsed = safeJsonParse(rawText);

    if (!res.ok) {
      const detail =
        parsed.ok
          ? JSON.stringify(parsed.value, null, 2)
          : rawText
            ? rawText
            : "(no response body)";
      throw new Error(`HTTP ${res.status} ${res.statusText}\n${detail}`);
    }

    if (!parsed.ok) {
      throw new Error(`JSONパースに失敗しました。\n${rawText || "(empty body)"}`);
    }

    return parsed.value;
  }

  // =========================================================
  // 7) 送信ハンドラ
  // =========================================================
  async function onSend() {
    const text = normalizeUserText(inputEl.value);
    if (!text) return;

    ensurePanelOpenSoftly();

    appendUser(text);
    inputEl.value = "";

    setSending(true);
    try {
      const data = await callWorker(text);

      // 想定：{ ok:true, reply:string, nextState:object, (debug?:object) }
      if (!data || typeof data !== "object") {
        appendError("Worker応答が不正です（オブジェクトではありません）", String(data));
        return;
      }

      if (data.ok !== true) {
        appendError("Workerが ok:true を返しませんでした", JSON.stringify(data, null, 2));
        return;
      }

      const reply = typeof data.reply === "string" ? data.reply : "";
      if (!reply) {
        appendError("reply が空、または文字列ではありません", JSON.stringify(data, null, 2));
      } else {
        appendLucy(reply);
      }

      const ns = data.nextState && typeof data.nextState === "object" ? data.nextState : null;
      if (!ns) {
        appendError("nextState が取得できませんでした（次回以降の会話継続ができません）", JSON.stringify(data, null, 2));
      } else {
        nextState = ns;
        saveState(nextState);
      }

      // debug（ALLOW_DEBUG=1）対応
      if (data.debug) {
        try {
          console.log("[Lucy debug]", data.debug);
          // 画面に出さず、必要時に参照できるよう退避
          window.__LUCY_LAST_DEBUG = data.debug;
        } catch (_) {}
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      appendError("通信に失敗しました", msg);
      console.error("[recommend.js] send failed:", err);
    } finally {
      setSending(false);
      inputEl.focus();
    }
  }

  // =========================================================
  // 8) イベント配線
  // =========================================================
  sendBtn.addEventListener("click", onSend);

  // Enter で送信（Shift+Enter は無効：入力欄は input[type=text] なので基本発生しないが保険）
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      onSend();
    }
  });

  // デバッグ用：コンソールから state を消したい時
  window.__LUCY_CLEAR_STATE = () => {
    nextState = null;
    saveState(null);
    console.log("[Lucy] state cleared");
  };

})();
