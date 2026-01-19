/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 * Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★ Quest対応修正版：
 * - MIME Type の指定を廃止し、Lobby.js と同様にブラウザ標準（デフォルト）の録音形式を使用する。
 * - これにより Meta Quest Browser での録音不具合を解消する。
 */
(() => {
  "use strict";

  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

  /**
   * 音声→テキスト用エンドポイント
   * 例: https://.../chat なら https://.../voice を想定
   */
  const WORKER_VOICE_URL = (() => {
    if (typeof window !== "undefined" && window.__LUCY_VOICE_URL) return String(window.__LUCY_VOICE_URL);

    const s = String(WORKER_CHAT_URL || "");
    if (/\/chat(\?.*)?$/i.test(s)) return s.replace(/\/chat(\?.*)?$/i, "/voice");
    return s.replace(/\/+$/, "") + "/voice";
  })();

  /**
   * 音声認識の優先順位
   * Questの場合は index.html 側で window.__LUCY_VOICE_MODE = "server" が指定されている想定
   */
  const VOICE_MODE = (() => {
    if (typeof window !== "undefined" && window.__LUCY_VOICE_MODE) return String(window.__LUCY_VOICE_MODE);
    return "auto";
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

  // 音声録音用（server /voice ルート）
  let voiceMediaStream = null;
  let voiceMediaRecorder = null;
  let voiceChunks = [];
  let voiceIsRecording = false;

  // SpeechRecognition ルート
  let speechRec = null;
  let speechIsRunning = false;

  // ボタン表示文言の保持
  const VOICE_BTN_LABEL_IDLE = "Lucyに質問（音声）";
  const VOICE_BTN_LABEL_STOP = "音声停止";

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

  function setLucyVoiceBtnLabel(isActive) {
    if (!lucyVoiceAskBtn) return;
    lucyVoiceAskBtn.textContent = isActive ? VOICE_BTN_LABEL_STOP : VOICE_BTN_LABEL_IDLE;
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

    // JSONが返る想定
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

    // JSONじゃない・または text が無い場合
    const maybeText = normalizeUserText(raw);
    if (maybeText) return maybeText;

    throw new Error("VOICE: transcription result missing");
  }

  // =========================================================
  // 6) 送信処理（テキスト）
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
  // 6.5) 音声質問
  // =========================================================
  function getSpeechRecognitionCtor() {
    const w = typeof window !== "undefined" ? window : null;
    if (!w) return null;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  async function sendRecognizedTextToLucy(text) {
    const t = normalizeUserText(text);
    if (!t) throw new Error("empty transcript");

    ensurePanelOpenSoftly();
    appendUser(t);

    const data = await callWorker(t);
    if (data.reply) appendLucy(data.reply);
    if (data.nextState) nextState = data.nextState;
    if (data.debug) console.log("[Lucy debug]", data.debug);
  }

  // ---------- SpeechRecognition ルート ----------
  function startSpeechRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) throw new Error("SpeechRecognition not available");

    stopSpeechRecognition();

    speechRec = new Ctor();
    speechRec.lang = (typeof window !== "undefined" && window.__DD_LANG) ? String(window.__DD_LANG) : "ja-JP";
    speechRec.interimResults = false;
    speechRec.continuous = false;

    speechIsRunning = true;
    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus("音声認識中です。話し終えたら自動で送信します。");

    speechRec.onresult = async (ev) => {
      try {
        const res = ev && ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : "";
        setLucyVoiceStatus(`認識：${normalizeUserText(res)}`);

        setSending(true);
        await sendRecognizedTextToLucy(res);
        setLucyVoiceStatus("完了しました。");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus("音声認識結果の送信に失敗しました。");
        appendError("音声の処理に失敗しました", e.message);
      } finally {
        setSending(false);
      }
    };

    speechRec.onerror = (ev) => {
      const msg = (ev && ev.error) ? String(ev.error) : "unknown";
      setLucyVoiceStatus(`音声認識エラー：${msg}`);
    };

    speechRec.onend = () => {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);
    };

    try {
      speechRec.start();
    } catch (e) {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);
      throw e;
    }
  }

  function stopSpeechRecognition() {
    if (!speechRec) return;
    try { speechRec.onresult = null; speechRec.onerror = null; speechRec.onend = null; } catch (_) {}
    try { speechRec.stop(); } catch (_) {}
    speechRec = null;
    speechIsRunning = false;
    setLucyVoiceBtnLabel(false);
  }

  // ---------- /voice（MediaRecorder）ルート ----------
  // ★ Lobby.js と同様、MIME Type 指定を排除し、ブラウザのデフォルト挙動に任せる
  async function startServerVoiceRecording() {
    if (voiceIsRecording) return;
    voiceIsRecording = true;
    voiceChunks = [];

    ensurePanelOpenSoftly();
    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus("録音中です。もう一度押すと停止します。");

    try {
      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setLucyVoiceStatus("マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。");
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
      return;
    }

    try {
      // ★ 修正点: options（MIME Type）を指定せず、デフォルトを使用する
      voiceMediaRecorder = new MediaRecorder(voiceMediaStream);
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("このブラウザでは録音機能が使えません。");
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
      return;
    }

    voiceMediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
    };

    voiceMediaRecorder.onstop = async () => {
      // ★ ここも Lobby.js に合わせる。
      // MIME Type が何であれ、Blob作成時にはブラウザが記録した形式 or audio/webm として扱う
      // （※ Questブラウザではこれで送信しないとデータが空になることがある）
      const blob = new Blob(voiceChunks, { type: "audio/webm" });

      voiceChunks = [];
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);

      if (!blob || blob.size === 0) {
        setLucyVoiceStatus("音声データが取得できませんでした。もう一度お試しください。");
        return;
      }

      setLucyVoiceStatus("音声を送信しています…");
      setSending(true);
      try {
        const text = normalizeUserText(await transcribeVoiceBlob(blob));
        setLucyVoiceStatus(`認識：${text}`);

        await sendRecognizedTextToLucy(text);
        setLucyVoiceStatus("完了しました。");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus("音声の処理に失敗しました。");
        appendError("音声の処理に失敗しました", e.message);
      } finally {
        setSending(false);
      }
    };

    voiceMediaRecorder.onerror = (ev) => {
      console.error(ev);
      setLucyVoiceStatus("録音中にエラーが発生しました。");
      try { stopVoiceTracks(); } catch (_) {}
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
    };

    try {
      voiceMediaRecorder.start();
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("録音の開始に失敗しました。");
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
    }
  }

  function stopServerVoiceRecording() {
    if (!voiceIsRecording) return;
    setLucyVoiceStatus("録音を停止しました。解析中…");
    try {
      if (voiceMediaRecorder && voiceMediaRecorder.state !== "inactive") {
        voiceMediaRecorder.stop();
      }
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("録音停止に失敗しました。");
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
    }
  }

  // ---------- 入口（ボタン押下） ----------
  function isVoiceActive() {
    return !!voiceIsRecording || !!speechIsRunning;
  }

  async function startVoiceFlow() {
    if (isVoiceActive()) return;

    // モード判定
    const hasSpeech = !!getSpeechRecognitionCtor();

    if (VOICE_MODE === "speech") {
      startSpeechRecognition();
      return;
    }

    if (VOICE_MODE === "server") {
      await startServerVoiceRecording();
      return;
    }

    // auto
    if (hasSpeech) {
      try {
        startSpeechRecognition();
        return;
      } catch (e) {
        // フォールバック
      }
    }
    await startServerVoiceRecording();
  }

  function stopVoiceFlow() {
    if (speechIsRunning) {
      setLucyVoiceStatus("音声認識を停止しました。");
      stopSpeechRecognition();
      return;
    }
    if (voiceIsRecording) {
      stopServerVoiceRecording();
      return;
    }
  }

  if (lucyVoiceAskBtn) {
    setLucyVoiceBtnLabel(false);
    lucyVoiceAskBtn.addEventListener("click", async () => {
      if (lucyVoiceAskBtn.disabled) return;
      try {
        if (!isVoiceActive()) {
          await startVoiceFlow();
        } else {
          stopVoiceFlow();
        }
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus("音声機能の起動に失敗しました。");
        appendError("音声の処理に失敗しました", e.message);
        try { stopVoiceFlow(); } catch (_) {}
        setLucyVoiceBtnLabel(false);
      }
    });
  }

  // =========================================================
  // 7) 初回アクセス：必ず S0（挨拶）
  // =========================================================
  (async () => {
    setSending(true);
    try {
      const data = await callWorker(null); 
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