/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 *   Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★方針変更（今回の修正）：
 * - state / chat の永続化は完全に廃止（リロード記憶なし）
 * - 初回アクセス時は必ず S0（挨拶）を Worker に要求する
 */
(() => {
  "use strict";

  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

  // =========================================================
  // 2) DOM取得
  // =========================================================
  const inputEl = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatEl  = document.getElementById("recommendChat");

  const touristInfoBtn = document.getElementById("touristInfoBtn");
  const recommendSection = document.getElementById("recommendSection");

  if (!inputEl || !sendBtn || !chatEl) {
    console.warn("[recommend.js] Required DOM not found.");
    return;
  }

  // =========================================================
  // 3) 内部状態（メモリ上のみ）
  // =========================================================
  let nextState = null;

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
      if (sendBtn.dataset._prevText) {
        sendBtn.textContent = sendBtn.dataset._prevText;
        delete sendBtn.dataset._prevText;
      }
    }
  }

  function normalizeUserText(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeLucyReplyToHtml(rawText) {
    const input = String(rawText || "").replace(/\r\n/g, "\n");

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${input}</div>`, "text/html");
    const root = doc.body.firstElementChild;

    function isSafeHttpUrl(url) {
      try {
        const u = new URL(url, location.href);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch {
        return false;
      }
    }

    function walk(node, out) {
      if (!node) return;

      if (node.nodeType === Node.TEXT_NODE) {
        const parts = node.nodeValue.split("\n");
        parts.forEach((p, i) => {
          out.push(escapeHtml(p));
          if (i < parts.length - 1) out.push("<br>");
        });
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const tag = node.tagName.toLowerCase();

        if (tag === "br") {
          out.push("<br>");
          return;
        }

        if (tag === "a") {
          const href = node.getAttribute("href") || "";
          const text = node.textContent || "";
          if (isSafeHttpUrl(href)) {
            out.push(
              `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(text)}</a>`
            );
          } else {
            out.push(escapeHtml(text));
          }
          return;
        }

        Array.from(node.childNodes).forEach(c => walk(c, out));
      }
    }

    const out = [];
    Array.from(root.childNodes).forEach(n => walk(n, out));
    return out.join("");
  }

  function appendMessage(role, label, content, isHtml) {
    const line = document.createElement("div");
    line.className = `chat-line chat-${role}`;

    const prefix = document.createElement("span");
    prefix.className = "chat-prefix";
    prefix.textContent = `${label}: `;

    const body = document.createElement("span");
    body.className = "chat-body";
    if (isHtml) body.innerHTML = content;
    else body.textContent = content;

    line.append(prefix, body);
    chatEl.appendChild(line);
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  const appendUser = t => appendMessage("user", "You", t, false);
  const appendLucy = t => appendMessage("lucy", "Lucy", sanitizeLucyReplyToHtml(t), true);
  const appendError = (t, d) =>
    appendMessage("error", "ERROR", d ? `${t}\n${d}` : t, false);

  function ensurePanelOpenSoftly() {
    if (!recommendSection) return;
    if (recommendSection.classList.contains("is-collapsed")) {
      recommendSection.classList.remove("is-collapsed");
      if (touristInfoBtn) touristInfoBtn.setAttribute("aria-expanded", "true");
    }
  }

  // =========================================================
  // 5) Worker 呼び出し
  // =========================================================
  async function callWorker(userText) {
    const payload = {};
    if (userText) payload.userText = userText;
    if (nextState) payload.state = nextState;

    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}\n${raw}`);
    }
    if (!parsed.ok) {
      throw new Error(`JSON parse failed\n${raw}`);
    }
    return parsed.value;
  }

  // =========================================================
  // 6) 送信処理
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

      if (data.reply) appendLucy(data.reply);
      if (data.nextState) nextState = data.nextState;

      if (data.debug) console.log("[Lucy debug]", data.debug);
    } catch (e) {
      appendError("通信に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
      inputEl.focus();
    }
  }

  // =========================================================
  // 7) 初回アクセス：必ず S0（挨拶）
  // =========================================================
  (async () => {
    setSending(true);
    try {
      const data = await callWorker(null); // state なし = S0
      if (data.reply) appendLucy(data.reply);
      if (data.nextState) nextState = data.nextState;
    } catch (e) {
      appendError("初期化に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
    }
  })();

  // =========================================================
  // 8) イベント
  // =========================================================
  sendBtn.addEventListener("click", onSend);

  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      onSend();
    }
  });

})();
