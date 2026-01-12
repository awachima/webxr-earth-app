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
 *   - 可能なら SpeechRecognition（ブラウザ内音声認識）を優先
 *   - SpeechRecognition が無い/失敗したら MediaRecorderで録音→/voice へ送信→文字起こし→/chat へ
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

  /**
   * 音声→テキスト用エンドポイント（推定）
   * 例: https://.../chat なら https://.../voice を想定
   * - 明示的に上書きしたい場合は window.__LUCY_VOICE_URL を index.html 側で設定
   */
  const WORKER_VOICE_URL = (() => {
    if (typeof window !== "undefined" && window.__LUCY_VOICE_URL) return String(window.__LUCY_VOICE_URL);

    const s = String(WORKER_CHAT_URL || "");
    if (/\/chat(\?.*)?$/i.test(s)) return s.replace(/\/chat(\?.*)?$/i, "/voice");
    return s.replace(/\/+$/, "") + "/voice";
  })();

  /**
   * 音声認識の優先順位
   * - "auto": SpeechRecognition があれば優先。無ければ /voice。
   * - "speech": SpeechRecognition のみ（/voice を使わない）
   * - "server": /voice のみ（SpeechRecognition を使わない）
   *
   * 必要なら index.html で window.__LUCY_VOICE_MODE = "server" 等を設定
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
  // 6.5) 音声質問（SpeechRecognition 優先 → 失敗時 /voice）
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

    // 既存があれば止める
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
      // "no-speech" / "not-allowed" / "network" 等
      const msg = (ev && ev.error) ? String(ev.error) : "unknown";
      setLucyVoiceStatus(`音声認識エラー：${msg}`);
    };

    speechRec.onend = () => {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);
      // status は直近の文言を残す
    };

    try {
      speechRec.start();
    } catch (e) {
      // start 二重呼び出し等
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
  function pickBestAudioMimeType() {
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];
    if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
    for (const t of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(t)) return t;
      } catch (_) {}
    }
    return "";
  }

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
      const mimeType = pickBestAudioMimeType();
      voiceMediaRecorder = mimeType ? new MediaRecorder(voiceMediaStream, { mimeType }) : new MediaRecorder(voiceMediaStream);
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus("このブラウザでは録音機能（MediaRecorder）が使えません。");
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
      return;
    }

    voiceMediaRecorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
    };

    voiceMediaRecorder.onstop = async () => {
      const recordedMime = (voiceMediaRecorder && voiceMediaRecorder.mimeType) ? voiceMediaRecorder.mimeType : "audio/webm";
      const blob = new Blob(voiceChunks, { type: recordedMime || "audio/webm" });

      voiceChunks = [];
      stopVoiceTracks();

      // 録音状態はここで確実に解除（stop が何経路でも）
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
        setLucyVoiceStatus("音声の処理に失敗しました。/voice の実装（URL・レスポンス形式）をご確認ください。");
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
    // ここでは onstop に処理を任せる（voiceIsRecording の解除も onstop 側で確実に）
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
    // 既に動作中なら何もしない（二重起動防止）
    if (isVoiceActive()) return;

    // モードに応じて分岐
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
        console.warn("[recommend.js] SpeechRecognition failed, fallback to /voice:", e);
        // フォールバック
      }
    }
    await startServerVoiceRecording();
  }

  function stopVoiceFlow() {
    // SpeechRecognition が走っていれば止める
    if (speechIsRunning) {
      setLucyVoiceStatus("音声認識を停止しました。");
      stopSpeechRecognition();
      return;
    }

    // /voice 録音が走っていれば止める
    if (voiceIsRecording) {
      stopServerVoiceRecording();
      return;
    }
  }

  if (lucyVoiceAskBtn) {
    // 初期文言を確実に整える
    setLucyVoiceBtnLabel(false);

    lucyVoiceAskBtn.addEventListener("click", async () => {
      // 送信中は何もしない（setSendingが disable しているが保険）
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
        // 念のため停止・復帰
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
