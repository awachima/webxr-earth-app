/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat / #lucyVoiceAskBtn) を使って
 *   Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★ 多言語対応:
 * - 言語切り替え (window.currentLang / window.__DD_LANG / localStorage) に動的に追従。
 * - UIテキストは window.i18n.recommend があれば参照（無ければデフォルト文言）。
 *
 * ★ チャットバブルUI:
 * - #recommendChat に msg-row / msg-bubble / msg-meta を追加して表示（Lucy=左 / You=右）
 *
 * ★ 選択肢ボタン化:
 * - Lucyの返答に箇条書きが含まれる場合、ボタン化してクリック送信
 * - 「どっちも違う」ボタンを追加
 *
 * ★ 音声:
 * - VOICE_MODE = "auto" | "browser" | "server"
 * - "auto" は SpeechRecognition が使えれば browser / それ以外は server
 *
 * ▼ 重要:
 * - Pages 側に /chat は無いので 405 になります。
 *   window.__LUCY_CHAT_URL があればそれを最優先、無ければ既定URLを使用します。
 */

(() => {
  "use strict";
  try { console.log("[recommend.js] loaded"); } catch (_) {}

  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL_DEFAULT = "https://lucy-recommend.awachima7.workers.dev/chat";

  const WORKER_CHAT_URL = (() => {
    if (typeof window !== "undefined" && window.__LUCY_CHAT_URL) return String(window.__LUCY_CHAT_URL);
    return WORKER_CHAT_URL_DEFAULT;
  })();

  const WORKER_VOICE_URL = (() => {
    if (typeof window !== "undefined" && window.__LUCY_VOICE_URL) return String(window.__LUCY_VOICE_URL);
    const s = String(WORKER_CHAT_URL || "");
    if (/\/chat(\?.*)?$/i.test(s)) return s.replace(/\/chat(\?.*)?$/i, "/voice");
    return s.replace(/\/+$/, "") + "/voice";
  })();

  const VOICE_MODE = (() => {
    if (typeof window !== "undefined" && window.__LUCY_VOICE_MODE) return String(window.__LUCY_VOICE_MODE);
    return "auto";
  })();

  try {
    const u = new URL(WORKER_CHAT_URL, location.href);
    if (u.origin === location.origin) {
      console.warn("[recommend.js] WORKER_CHAT_URL looks same-origin. If it's '/chat', it will 405 on Pages. URL=", WORKER_CHAT_URL);
    }
  } catch (_) {}

  // =========================================================
  // 2) 言語
  // =========================================================
  const getCurrentLang = () => {
    if (typeof window !== "undefined" && window.currentLang) return String(window.currentLang);
    if (typeof window !== "undefined" && window.__DD_LANG) return String(window.__DD_LANG);
    try {
      const stored = localStorage.getItem("lang");
      if (stored) return stored;
    } catch (_) {}
    if (document.documentElement.lang) return document.documentElement.lang;
    return "ja";
  };

  const getTerm = (key, def) => {
    try {
      const lang = getCurrentLang();
      const rec = window.i18n && window.i18n.recommend;
      if (!rec) return def;

      if (rec[lang] && rec[lang][key]) return rec[lang][key];
      if (rec.ja && rec.ja[key]) return rec.ja[key];
      if (rec[key]) return rec[key];
    } catch (_) {}
    return def;
  };

  const langToSpeechLocale = (lang) => {
    const l = String(lang || "ja").toLowerCase();
    if (l === "ja") return "ja-JP";
    if (l === "en") return "en-US";
    if (l === "zh") return "zh-CN";
    if (l === "hi") return "hi-IN";
    if (l === "he") return "he-IL";
    if (l === "fa") return "fa-IR";
    return "ja-JP";
  };

  // =========================================================
  // 3) DOM取得
  // =========================================================
  const inputEl = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatEl = document.getElementById("recommendChat");

  const touristInfoBtn = document.getElementById("touristInfoBtn");
  const recommendSection = document.getElementById("recommendSection");

  const lucyVoiceAskBtn = document.getElementById("lucyVoiceAskBtn");
  const lucyVoiceAskStatus = document.getElementById("lucyVoiceAskStatus");

  if (!inputEl || !sendBtn || !chatEl) {
    console.warn("[recommend.js] Required DOM not found.");
    return;
  }

  // =========================================================
  // 4) 内部状態
  // =========================================================
  let nextState = null;

  let voiceMediaStream = null;
  let voiceMediaRecorder = null;
  let voiceChunks = [];
  let voiceIsRecording = false;

  let speechRec = null;
  let speechIsRunning = false;
  let lastSpeechFinal = "";

  // =========================================================
  // 5) ユーティリティ
  // =========================================================
  function safeJsonParse(text) {
    try {
      return { ok: true, value: JSON.parse(text) };
    } catch (e) {
      return { ok: false, error: e };
    }
  }

  function setSending(isSending) {
    sendBtn.disabled = !!isSending;
    inputEl.disabled = !!isSending;
    if (lucyVoiceAskBtn) lucyVoiceAskBtn.disabled = !!isSending;

    if (isSending) {
      sendBtn.dataset._prevText = sendBtn.textContent || "";
      sendBtn.textContent = getTerm("sendLoading", "送信中…");
    } else {
      const fallback = sendBtn.dataset._prevText || "質問する";
      sendBtn.textContent = getTerm("send", fallback);
      if (sendBtn.dataset._prevText) delete sendBtn.dataset._prevText;
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

  function stripTags(html) {
    return String(html || "").replace(/<\/?[^>]+>/g, "");
  }

  function escapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function sanitizeAnchorHtml(anchorHtml) {
    try {
      const hrefMatch = anchorHtml.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const hrefRaw = hrefMatch ? (hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || "") : "";
      const href = String(hrefRaw || "").trim();
      if (!/^https?:\/\//i.test(href)) return escapeHtml(stripTags(anchorHtml));

      const label = stripTags(anchorHtml).trim() || href;
      const safeHref = escapeHtml(href);
      const safeLabel = escapeHtml(label);
      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
    } catch (_) {
      return escapeHtml(stripTags(anchorHtml));
    }
  }

  function sanitizeLucyReplyToHtml(rawText) {
    const original = String(rawText || "");

    const anchorTokens = [];
    let text = original.replace(/<a\b[\s\S]*?<\/a>/gi, (m) => {
      const safe = sanitizeAnchorHtml(m);
      const token = `__ANCHOR_TOKEN_${anchorTokens.length}__`;
      anchorTokens.push({ token, html: safe });
      return token;
    });

    let html = escapeHtml(text);

    const urlRe = /(https?:\/\/[^\s<>"']+)/g;
    html = html.replace(urlRe, (m) => {
      const trimmed = m.replace(/[)\]、。．，.]+$/g, (x) => x);
      const suffix = m.slice(trimmed.length);
      const safe = escapeHtml(trimmed);
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>${escapeHtml(suffix)}`;
    });

    for (const a of anchorTokens) {
      const tokenRe = new RegExp(escapeRegExp(a.token), "g");
      html = html.replace(tokenRe, a.html);
    }

    html = html.replace(/\r?\n/g, "<br>");
    return html;
  }

  function extractChoicesFromLucyReply(rawText) {
    const text = String(rawText || "");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const choices = [];
    for (const line of lines) {
      if (/https?:\/\//i.test(line)) continue;

      const m =
        line.match(/^[・\-\*]\s*(.+)$/) ||
        line.match(/^\d+\.\s*(.+)$/) ||
        line.match(/^\(\d+\)\s*(.+)$/);

      if (!m) continue;

      const c = String(m[1] || "").trim();
      if (!c) continue;

      const cleaned = c.replace(/[：:\-–—]\s*$/g, "").trim();
      if (!cleaned) continue;

      if (!choices.includes(cleaned)) choices.push(cleaned);
    }

    if (choices.length < 2) return null;
    return { choices };
  }

  // =========================================================
  // 6) UI描画
  // =========================================================
  function appendBubble(role, label, content, isHtml) {
    const row = document.createElement("div");
    row.className = `msg-row ${role === "assistant" ? "assistant" : "user"}`;

    const bubble = document.createElement("div");
    bubble.className = `msg-bubble ${role === "assistant" ? "assistant" : "user"}`;

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = label;

    const body = document.createElement("div");
    body.className = "msg-body";
    if (isHtml) body.innerHTML = content;
    else body.textContent = content;

    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    chatEl.appendChild(row);
    chatEl.scrollTop = chatEl.scrollHeight;

    return { row, bubble, body };
  }

  const appendUser = (t) => appendBubble("user", "You", t, false);

  function appendLucy(rawText) {
    const html = sanitizeLucyReplyToHtml(rawText);
    const parts = appendBubble("assistant", "Lucy", html, true);

    const extracted = extractChoicesFromLucyReply(rawText);
    if (extracted && extracted.choices && extracted.choices.length >= 2) {
      const choices = extracted.choices;

      const wrap = document.createElement("div");
      wrap.className = "lucy-choice-wrap";
      wrap.style.marginTop = "10px";
      wrap.style.display = "flex";
      wrap.style.gap = "8px";
      wrap.style.flexWrap = "wrap";

      const makeBtn = (label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lucy-choice-btn";
        btn.textContent = label;

        btn.style.padding = "8px 10px";
        btn.style.borderRadius = "10px";
        btn.style.border = "1px solid rgba(0,0,0,0.15)";
        btn.style.background = "#fff";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "14px";

        btn.addEventListener("click", async () => {
          if (sendBtn.disabled) return;

          try {
            const all = wrap.querySelectorAll("button");
            all.forEach((b) => (b.disabled = true));
          } catch (_) {}

          inputEl.value = label;
          await onSend();
        });

        return btn;
      };

      choices.forEach((c) => wrap.appendChild(makeBtn(c)));
      wrap.appendChild(makeBtn(getTerm("choiceNeither", "どっちも違う")));

      parts.bubble.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
    }
  }

  const appendError = (t, d) => {
    const msg = d ? `${t}\n${d}` : t;
    appendBubble("assistant", "ERROR", msg, false);
  };

  function ensurePanelOpenSoftly() {
    if (!recommendSection) return;
    if (recommendSection.classList.contains("is-collapsed")) {
      recommendSection.classList.remove("is-collapsed");
      if (touristInfoBtn) touristInfoBtn.setAttribute("aria-expanded", "true");
    }
  }

  // ★ステータス表示（opacity=0 を強制解除する）
  function setLucyVoiceStatus(text) {
    if (!lucyVoiceAskStatus) return;

    const t = String(text || "").trim();

    if (!t) {
      lucyVoiceAskStatus.textContent = "";
      // 隙間を消す（display:none）＋ 透明化（念のため）
      lucyVoiceAskStatus.style.setProperty("opacity", "0", "important");
      lucyVoiceAskStatus.style.setProperty("display", "none", "important");
      return;
    }

    lucyVoiceAskStatus.textContent = t;

    // ★ここが肝：見えない原因が opacity:0 なので、必ず 1 に戻す
    lucyVoiceAskStatus.style.setProperty("display", "block", "important");
    lucyVoiceAskStatus.style.setProperty("opacity", "1", "important");
    lucyVoiceAskStatus.style.setProperty("visibility", "visible", "important");
  }

  function setLucyVoiceBtnVisual(isActive) {
    if (!lucyVoiceAskBtn) return;

    if (isActive) {
      lucyVoiceAskBtn.style.backgroundColor = "rgb(11, 53, 89)";
      lucyVoiceAskBtn.style.color = "#fff";
      lucyVoiceAskBtn.style.borderColor = "rgb(11, 53, 89)";
    } else {
      lucyVoiceAskBtn.style.backgroundColor = "";
      lucyVoiceAskBtn.style.color = "";
      lucyVoiceAskBtn.style.borderColor = "";
    }
  }

  function setLucyVoiceBtnLabel(isActive) {
    if (!lucyVoiceAskBtn) return;

    if (isActive) {
      lucyVoiceAskBtn.textContent = getTerm("voiceBtnSpeakToSend", "話し終えたら送信");
    } else {
      lucyVoiceAskBtn.textContent = getTerm("voiceBtnIdle", "Lucyに質問（音声）");
    }

    setLucyVoiceBtnVisual(isActive);
  }

  function stopVoiceTracks() {
    if (voiceMediaStream) {
      try { voiceMediaStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    }
    voiceMediaStream = null;
  }

  // =========================================================
  // 7) Worker 呼び出し
  // =========================================================
  async function callWorker(userText) {
    const payload = {};
    if (userText) payload.userText = userText;
    if (nextState) payload.state = nextState;

    payload.lang = getCurrentLang();

    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) throw new Error(`HTTP ${res.status}\n${raw}`);
    if (!parsed.ok) throw new Error(`JSON parse failed\n${raw}`);
    return parsed.value;
  }

  async function sendTextDirect(text) {
    const t = normalizeUserText(text);
    if (!t) return;
    inputEl.value = t;
    await onSend();
  }

  // =========================================================
  // 8) 送信処理
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
  // 9) 音声：browser（SpeechRecognition）
  // =========================================================
  function getSpeechRecognitionCtor() {
    const w = window;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  function ensureSpeechRec() {
    if (speechRec) return true;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;

    const rec = new Ctor();
    rec.continuous = false;
    rec.interimResults = false;

    rec.onstart = () => {
      speechIsRunning = true;
      lastSpeechFinal = "";
      setLucyVoiceBtnLabel(true);
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
    };

    rec.onresult = async (ev) => {
      try {
        let finalText = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r && r.isFinal && r[0] && r[0].transcript) {
            finalText += (finalText ? " " : "") + r[0].transcript;
          }
        }
        finalText = normalizeUserText(finalText);
        if (finalText) {
          lastSpeechFinal = finalText;
          setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
          await sendTextDirect(finalText);
          setLucyVoiceStatus("");
        }
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
      }
    };

    rec.onerror = (e) => {
      console.warn("[SpeechRecognition] error", e);
      setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
    };

    rec.onend = () => {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);

      if (!lastSpeechFinal) {
        setLucyVoiceStatus(getTerm("voiceNoResult", "聞き取れませんでした。もう一度お試しください。"));
      }
    };

    speechRec = rec;
    return true;
  }

  async function startBrowserSpeech() {
    if (!ensureSpeechRec()) {
      setLucyVoiceStatus(getTerm("voiceUnsupported", "このブラウザでは音声認識が利用できません"));
      return;
    }
    try {
      speechRec.lang = langToSpeechLocale(getCurrentLang());
      speechRec.start();
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);
    }
  }

  function stopBrowserSpeech() {
    try {
      if (speechRec && speechIsRunning) speechRec.stop();
    } catch (_) {}
  }

  // =========================================================
  // 10) 音声：server（MediaRecorder → /voice）
  // =========================================================
  async function startServerVoice() {
    try {
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));

      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
      let mimeType = "";
      for (const m of mimeCandidates) {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) {
          mimeType = m;
          break;
        }
      }

      voiceChunks = [];
      voiceMediaRecorder = new MediaRecorder(voiceMediaStream, mimeType ? { mimeType } : undefined);

      voiceMediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
      };

      voiceMediaRecorder.onstart = () => {
        voiceIsRecording = true;
        setLucyVoiceBtnLabel(true);
        setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
      };

      voiceMediaRecorder.onerror = (e) => {
        console.error(e);
        setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
      };

      voiceMediaRecorder.onstop = async () => {
        try {
          setLucyVoiceBtnLabel(false);
          voiceIsRecording = false;
          setLucyVoiceStatus(getTerm("voiceUploading", "解析中…"));

          const blob = new Blob(voiceChunks, { type: voiceMediaRecorder.mimeType || "audio/webm" });
          voiceChunks = [];

          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          fd.append("lang", getCurrentLang());

          const res = await fetch(WORKER_VOICE_URL, { method: "POST", body: fd });
          const raw = await res.text();
          const parsed = safeJsonParse(raw);

          if (!res.ok) throw new Error(`HTTP ${res.status}\n${raw}`);
          if (!parsed.ok) throw new Error(`JSON parse failed\n${raw}`);

          const text = normalizeUserText(parsed.value && parsed.value.text);
          if (!text) {
            setLucyVoiceStatus(getTerm("voiceNoResult", "聞き取れませんでした。もう一度お試しください。"));
            return;
          }

          setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
          await sendTextDirect(text);
          setLucyVoiceStatus("");
        } catch (e) {
          console.error(e);
          setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
        } finally {
          stopVoiceTracks();
          voiceMediaRecorder = null;
        }
      };

      voiceMediaRecorder.start();
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus(getTerm("voicePermissionDenied", "マイクの許可が必要です"));
      setLucyVoiceBtnLabel(false);
      voiceIsRecording = false;
      stopVoiceTracks();
    }
  }

  function stopServerVoice() {
    try {
      if (voiceMediaRecorder && voiceIsRecording) voiceMediaRecorder.stop();
    } catch (_) {
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
    }
  }

  // =========================================================
  // 11) 音声トグル
  // =========================================================
  function resolveVoiceMode() {
    const m = String(VOICE_MODE || "auto").toLowerCase();
    if (m === "browser") return "browser";
    if (m === "server") return "server";
    return getSpeechRecognitionCtor() ? "browser" : "server";
  }

  async function toggleVoice() {
    if (sendBtn.disabled) return;

    if (speechIsRunning) {
      stopBrowserSpeech();
      return;
    }
    if (voiceIsRecording) {
      stopServerVoice();
      return;
    }

    setLucyVoiceStatus("");
    const mode = resolveVoiceMode();
    console.log("[voice] mode=", mode, "VOICE_MODE=", VOICE_MODE, "chat=", WORKER_CHAT_URL, "voice=", WORKER_VOICE_URL);

    if (mode === "browser") {
      await startBrowserSpeech();
    } else {
      await startServerVoice();
    }
  }

  // =========================================================
  // 12) 初期化
  // =========================================================
  (async () => {
    setLucyVoiceStatus("");

    setSending(true);
    try {
      const data = await callWorker(null);
      if (data.reply) appendLucy(data.reply);
      if (data.nextState) nextState = data.nextState;
      if (data.debug) console.log("[Lucy debug]", data.debug);
    } catch (e) {
      appendError("初期化に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
    }
  })();

  sendBtn.addEventListener("click", onSend);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      onSend();
    }
  });

  if (lucyVoiceAskBtn) {
    setLucyVoiceBtnLabel(false);
    lucyVoiceAskBtn.addEventListener("click", toggleVoice);
  } else {
    console.warn("[recommend.js] lucyVoiceAskBtn not found.");
  }
})();
