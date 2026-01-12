/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 *   Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★方針変更（今回の修正）：
 * - state / chat の永続化は完全に廃止（リロード記憶なし）
 * - 初回アクセス時は必ず S0（挨拶）を Worker に要求する
 *
 * ★追加（今回）：
 * - Meta Quest などで「Lucyに質問（音声）」を使えるようにする
 *   - #lucyVoiceAskBtn / #lucyVoiceAskStatus が存在すれば有効化
 *   - MediaRecorderで録音→/voice（推定）へ送信→文字起こし結果を /chat に流す
 *
 * 期待する index.html 側の要素（追加してください）：
 *   <button id="lucyVoiceAskBtn" ...>Lucyに質問（音声）</button>
 *   <div id="lucyVoiceAskStatus" ...></div>
 */
(() => {
  "use strict";

  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

  // 音声→テキスト用エンドポイント（推定）
  // 例: https://.../chat なら https://.../voice を想定
  const WORKER_VOICE_URL = (() => {
    // 明示的に上書きしたい場合（必要なら index.html で window.__LUCY_VOICE_URL を設定）
    if (typeof window !== "undefined" && window.__LUCY_VOICE_URL) return String(window.__LUCY_VOICE_URL);

    const s = String(WORKER_CHAT_URL || "");
    // /chat で終わっていれば /voice に差し替え
    if (/\/chat(\?.*)?$/i.test(s)) return s.replace(/\/chat(\?.*)?$/i, "/voice");
    // それ以外は末尾に /voice を足す
    return s.replace(/\/+$/, "") + "/voice";
  })();

  // =========================================================
  // 2) DOM取得
  // =========================================================
  const inputEl = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatEl  = document.getElementById("recommendChat");

  const touristInfoBtn = document.getElementById("touristInfoBtn");
  const recommendSection = document.getElementById("recommendSection");

  // 追加：音声質問
  const lucyVoiceAskBtn = document.getElementById("lucyVoiceAskBtn");
  const lucyVoiceAskStatus = document.getElementById("lucyVoiceAskStatus");

  if (!inputEl || !sendBtn || !chatEl) {
    console.warn("[recommend.js] Required DOM not found.");
    return;
  }

  // =========================================================
  // 3) 内部状態（メモリ上のみ）
  // =========================================================
  let nextState = null;

  // 音声録音用
  let voiceMediaStream = null;
  let voiceMediaRecorder = null;
  let voiceChunks = [];
  let voiceIsRecording = false;

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
    if (lucyVoiceAskBtn) lucyVoiceAskBtn.disabled = !!isSending;

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

  function setLucyVoiceStatus(text) {
    if (!lucyVoiceAskStatus) return;
    lucyVoiceAskStatus.textContent = String(text || "");
  }

  function stopVoiceTracks() {
    if (voiceMediaStream) {
      try { voiceMediaStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    }
    voiceMediaStream = null;
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

  // 音声→文字起こし（/voice を想定）
  // サーバー実装が異なる可能性があるため、いくつかの形式を吸収します。
  async function transcribeVoiceBlob(blob) {
    const formData = new FormData();
    formData.append("audio", blob, "voice.webm");

    const res = await fetch(WORKER_VOICE_URL, {
      method: "POST",
      body: formData,
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) {
      throw new Error(`VOICE HTTP ${res.status}\n${raw}`);
    }

    // JSONが返る想定： { text: "..."} / { transcript: "..."} / { userText: "..."} / { ok:true, text:"..." }
    if (parsed.ok && parsed.value && typeof parsed.value === "object") {
      const v = parsed.value;
      const t =
        (typeof v.text === "string" && v.text) ||
        (typeof v.transcript === "string" && v.transcript) ||
        (typeof v.userText === "string" && v.userText) ||
        (v.result && typeof v.result.text === "string" && v.result.text) ||
        "";
      if (t) return t;
    }

    // JSONじゃない・または text が無い場合：生テキストとして扱う
    const maybeText = normalizeUserText(raw);
    if (maybeText) return maybeText;

    throw new Error("VOICE: transcription result missing");
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
  // 6.5) 音声質問（録音→文字起こし→Lucyへ送信）
  // =========================================================
  async function startLucyRecording() {
    if (voiceIsRecording) return;
    voiceIsRecording = true;
    voiceChunks = [];

    ensurePanelOpenSoftly();
    setLucyVoiceStatus("録音中です。もう一度押すと停止します。");

    if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "録音停止";

    try {
      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setLucyVoiceStatus("マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。");
      voiceIsRecording = false;
      if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "Lucyに質問（音声）";
      return;
    }

    try {
      voiceMediaRecorder = new MediaRecorder(voiceMediaStream);
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("このブラウザでは録音機能（MediaRecorder）が使えません。");
      stopVoiceTracks();
      voiceIsRecording = false;
      if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "Lucyに質問（音声）";
      return;
    }

    voiceMediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
    };

    voiceMediaRecorder.onstop = async () => {
      // stopRecording() から呼ばれる
      const blob = new Blob(voiceChunks, { type: "audio/webm" });
      voiceChunks = [];
      stopVoiceTracks();

      if (!blob || blob.size === 0) {
        setLucyVoiceStatus("音声データが取得できませんでした。もう一度お試しください。");
        if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "Lucyに質問（音声）";
        return;
      }

      setLucyVoiceStatus("音声を送信しています…");

      setSending(true);
      try {
        const text = normalizeUserText(await transcribeVoiceBlob(blob));
        if (!text) throw new Error("empty transcript");

        setLucyVoiceStatus(`認識：${text}`);

        // 既存のテキスト送信と同じルートへ
        appendUser(text);

        const data = await callWorker(text);

        if (data.reply) appendLucy(data.reply);
        if (data.nextState) nextState = data.nextState;

        if (data.debug) console.log("[Lucy debug]", data.debug);

        setLucyVoiceStatus("完了しました。");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus(
          "音声の処理に失敗しました。/voice の実装（URL・レスポンス形式）をご確認ください。"
        );
        appendError("音声の処理に失敗しました", e.message);
      } finally {
        setSending(false);
        if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "Lucyに質問（音声）";
      }
    };

    try {
      voiceMediaRecorder.start();
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("録音の開始に失敗しました。");
      stopVoiceTracks();
      voiceIsRecording = false;
      if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "Lucyに質問（音声）";
    }
  }

  function stopLucyRecording() {
    if (!voiceIsRecording) return;
    voiceIsRecording = false;

    setLucyVoiceStatus("録音を停止しました。解析中…");

    try {
      if (voiceMediaRecorder && voiceMediaRecorder.state !== "inactive") {
        voiceMediaRecorder.stop();
      }
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("録音停止に失敗しました。");
      stopVoiceTracks();
      if (lucyVoiceAskBtn) lucyVoiceAskBtn.textContent = "Lucyに質問（音声）";
    }
  }

  if (lucyVoiceAskBtn) {
    lucyVoiceAskBtn.addEventListener("click", () => {
      // 送信中は何もしない（setSendingが disable しているが保険）
      if (lucyVoiceAskBtn.disabled) return;

      if (!voiceIsRecording) startLucyRecording();
      else stopLucyRecording();
    });
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
