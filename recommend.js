/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 * Cloudflare Worker の /chat に POST し、reply と nextState を表示・保持する。
 * - 【変更点】localStorage（保存機能）を削除し、リロードで完全にリセットされるように修正。
 * - 【変更点】ページ読み込み時に自動で通信し、初回挨拶（S0）を表示する。
 */
(() => {
  "use strict";

  // =========================================================
  // 1) 設定
  // =========================================================
  // 正しいURLであることを確認済み
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

  // 画面ログの最大保持（チャット欄が長くなりすぎないように）
  const MAX_LOG_LINES = 60;

  // =========================================================
  // 2) DOM取得
  // =========================================================
  const inputEl = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatEl  = document.getElementById("recommendChat");

  // 補助UI（あれば連携）
  const touristInfoBtn = document.getElementById("touristInfoBtn");
  const recommendSection = document.getElementById("recommendSection");

  if (!inputEl || !sendBtn || !chatEl) {
    console.warn("[recommend.js] Required DOM not found.");
    return;
  }

  // =========================================================
  // 3) 内部状態（リロードで消える変数のみ）
  // =========================================================
  let nextState = null; // リロード時は必ず null (S0) からスタート

  // =========================================================
  // 4) ユーティリティ
  // =========================================================
  function safeJsonParse(text) {
    try { return { ok: true, value: JSON.parse(text) }; }
    catch (e) { return { ok: false, error: e }; }
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

  function normalizeUserText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  // HTMLエスケープ
  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Lucy返信のHTMLサニタイズ（リンクと改行のみ許可）
  function sanitizeLucyReplyToHtml(rawText) {
    const input = String(rawText || "");
    const withBr = input.replace(/\r\n/g, "\n");

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${withBr}</div>`, "text/html");
    const root = doc.body.firstElementChild;

    function isSafeHttpUrl(url) {
      try {
        const u = new URL(url, window.location.href);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch (_) {
        return false;
      }
    }

    function walk(node, outParts) {
      if (!node) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const t = node.nodeValue || "";
        const chunks = t.split("\n");
        for (let i = 0; i < chunks.length; i++) {
          outParts.push(escapeHtml(chunks[i]));
          if (i < chunks.length - 1) outParts.push("<br>");
        }
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = (node.tagName || "").toLowerCase();
        if (tag === "br") {
          outParts.push("<br>");
          return;
        }
        if (tag === "a") {
          const href = node.getAttribute("href") || "";
          const text = node.textContent || "";
          if (href && isSafeHttpUrl(href)) {
            const safeHref = escapeHtml(href);
            const safeText = escapeHtml(text);
            outParts.push(`<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeText}</a>`);
          } else {
            outParts.push(escapeHtml(text));
          }
          return;
        }
        const children = Array.from(node.childNodes || []);
        for (const c of children) walk(c, outParts);
        return;
      }
    }

    const parts = [];
    const children = Array.from((root && root.childNodes) ? root.childNodes : []);
    for (const c of children) walk(c, parts);
    return parts.join("");
  }

  // 1行追加
  function appendMessage(role, label, content, isHtml) {
    const line = document.createElement("div");
    line.className = `chat-line chat-${role}`;

    const prefix = document.createElement("span");
    prefix.className = "chat-prefix";
    prefix.textContent = `${label}: `;

    const body = document.createElement("span");
    body.className = "chat-body";

    if (isHtml) {
      body.innerHTML = content;
    } else {
      body.textContent = content;
    }

    line.appendChild(prefix);
    line.appendChild(body);
    chatEl.appendChild(line);

    chatEl.scrollTop = chatEl.scrollHeight;

    // ※ログ保存（localStorage）は削除しました
  }

  function appendUser(text) {
    appendMessage("user", "You", String(text || ""), false);
  }

  function appendLucy(replyText) {
    const html = sanitizeLucyReplyToHtml(replyText);
    appendMessage("lucy", "Lucy", html, true);
  }

  function appendError(title, detail) {
    const msg = detail ? `${title}\n${detail}` : title;
    appendMessage("error", "ERROR", msg, false);
  }

  // =========================================================
  // 5) Worker呼び出し
  // =========================================================
  async function callWorker(userText) {
    // 常に userText と、あれば nextState を送る
    const payload = { userText: userText };
    if (nextState && typeof nextState === "object") {
      payload.state = nextState;
    }

    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const rawText = await res.text().catch(() => "");
    const parsed = safeJsonParse(rawText);

    if (!res.ok) {
      const detail = parsed.ok ? JSON.stringify(parsed.value, null, 2) : rawText;
      throw new Error(`HTTP ${res.status} ${res.statusText}\n${detail}`);
    }
    if (!parsed.ok) {
      throw new Error(`JSONパース失敗\n${rawText}`);
    }
    return parsed.value;
  }

  // =========================================================
  // 6) 送信ハンドラ（ユーザー操作）
  // =========================================================
  async function onSend() {
    const text = normalizeUserText(inputEl.value);
    if (!text) return;

    if (recommendSection && recommendSection.classList.contains("is-collapsed")) {
      recommendSection.classList.remove("is-collapsed");
      if (touristInfoBtn) touristInfoBtn.setAttribute("aria-expanded", "true");
    }

    appendUser(text);
    inputEl.value = "";

    setSending(true);
    try {
      const data = await callWorker(text);
      handleWorkerResponse(data);
    } catch (err) {
      appendError("通信エラー", err.message);
      console.error(err);
    } finally {
      setSending(false);
      inputEl.focus();
    }
  }

  // 共通のレスポンス処理
  function handleWorkerResponse(data) {
    if (!data || typeof data !== "object") {
      appendError("不正な応答", String(data));
      return;
    }
    if (!data.ok) {
      appendError("Workerエラー", JSON.stringify(data, null, 2));
      return;
    }

    // Lucyの返信を表示
    const reply = data.reply || "";
    if (reply) {
      appendLucy(reply);
    }

    // 次の状態をメモリに保存（リロードで消える）
    if (data.nextState && typeof data.nextState === "object") {
      nextState = data.nextState;
    }

    // デバッグ情報
    if (data.debug) {
      console.log("[Lucy debug]", data.debug);
    }
  }

  // =========================================================
  // 7) 初期化：挨拶の自動取得 (Auto Greeting)
  // =========================================================
  async function initGreeting() {
    // 画面ロード時に自動的に空メッセージを送り、
    // S0（初期状態）の挨拶を引き出す
    setSending(true);
    try {
      // ユーザーの発言としては表示せず、いきなり通信する
      const data = await callWorker(""); 
      handleWorkerResponse(data);
    } catch (err) {
      // 初回挨拶に失敗した場合も静かにエラーを出す
      console.error("Greeting failed:", err);
      appendError("起動エラー", "サーバーとの通信に失敗しました。");
    } finally {
      setSending(false);
    }
  }

  // =========================================================
  // 8) イベント設定・実行
  // =========================================================
  if ((sendBtn.textContent || "").includes("近日公開")) {
    sendBtn.textContent = "質問する";