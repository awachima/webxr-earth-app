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
  let lucyGreetingShown = false;

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

  // =========================================================
  // 6) バブルUI
  // =========================================================
  function appendMessage(role, text, meta) {
    const row = document.createElement("div");
    row.className = `msg-row ${role === "user" ? "user" : "assistant"}`;

    const metaEl = document.createElement("div");
    metaEl.className = "msg-meta";
    metaEl.textContent = meta || (role === "user" ? "You" : "Lucy");

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";
    bubble.innerHTML = renderRichText(text);

    row.appendChild(metaEl);
    row.appendChild(bubble);
    chatEl.appendChild(row);

    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function appendYou(text) {
    appendMessage("user", text, "You");
  }

  function appendLucy(text) {
    appendMessage("assistant", text, "Lucy");
    try {
      enhanceChoiceButtonsForLastLucy();
    } catch (_) {}
  }

  function appendError(title, detail) {
    const t = title || "エラー";
    const d = detail ? `\n${detail}` : "";
    appendMessage("assistant", `⚠️ ${t}${d}`, "System");
  }

  // =========================================================
  // 7) Lucy返信のリッチ表示（リンク/箇条書きなど）
  // =========================================================
  function renderRichText(text) {
    const raw = String(text || "");
    const escaped = escapeHtml(raw);

    // URL をリンク化（簡易）
    const urlRe = /(https?:\/\/[^\s<>"']+)/g;
    let html = escaped.replace(urlRe, (m) => {
      const u = escapeHtml(m);
      return `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`;
    });

    // Worker から <a> が来る場合の保護（最小限）
    html = html.replace(/&lt;a\b[^&]*&gt;.*?&lt;\/a&gt;/gi, (m) => {
      const decoded = m
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");
      return sanitizeAnchorHtml(decoded);
    });

    // 改行
    html = html.replace(/\n/g, "<br>");
    return html;
  }

  // =========================================================
  // 8) Worker呼び出し
  // =========================================================
  async function callWorker(userText) {
    const payload = {
      text: userText === null ? null : normalizeUserText(userText),
      nextState: nextState,
      lang: getCurrentLang()
    };

    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
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
  // 9) 選択肢ボタン化
  // =========================================================
  function findLastLucyBubble() {
    const rows = chatEl.querySelectorAll(".msg-row.assistant .msg-bubble");
    if (!rows || rows.length === 0) return null;
    return rows[rows.length - 1];
  }

  function extractChoicesFromText(text) {
    const s = String(text || "");
    const lines = s.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);

    // "・" または "-" の行を候補に
    const bulletRe = /^([・\-]\s*)(.+)$/;
    const candidates = [];
    for (const line of lines) {
      const m = line.match(bulletRe);
      if (m && m[2]) candidates.push(m[2].trim());
    }
    return candidates;
  }

  function enhanceChoiceButtonsForLastLucy() {
    const lastBubble = findLastLucyBubble();
    if (!lastBubble) return;

    const text = stripTags(lastBubble.innerHTML)
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/&nbsp;/g, " ")
      .trim();

    const choices = extractChoicesFromText(text);
    if (!choices || choices.length < 2) return;

    // 既にボタンがあるなら二重生成しない
    if (lastBubble.querySelector(".choice-buttons")) return;

    const wrap = document.createElement("div");
    wrap.className = "choice-buttons";
    wrap.style.marginTop = "10px";
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "8px";

    const makeBtn = (label) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn ghost";
      b.textContent = label;
      b.addEventListener("click", () => {
        if (sendBtn.disabled) return;
        inputEl.value = label;
        onSend();
      });
      return b;
    };

    // 既存の2択 + 「どっちも違う」
    for (const c of choices.slice(0, 2)) {
      wrap.appendChild(makeBtn(c));
    }

    // 「どっちも違う」ボタン
    const noneLabel = getTerm("choiceNeither", "どっちも違う");
    wrap.appendChild(makeBtn(noneLabel));

    lastBubble.appendChild(wrap);
  }

  // =========================================================
  // 10) 送信
  // =========================================================
  async function sendTextDirect(userText) {
    const ut = normalizeUserText(userText);
    if (!ut) return;

    appendYou(ut);
    setSending(true);

    try {
      const data = await callWorker(ut);
      if (data.reply) appendLucy(data.reply);
      if (data.nextState) nextState = data.nextState;
      if (data.debug) console.log("[Lucy debug]", data.debug);
    } catch (e) {
      appendError("送信に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  async function onSend() {
    if (sendBtn.disabled) return;
    const ut = normalizeUserText(inputEl.value);
    if (!ut) return;

    inputEl.value = "";
    await sendTextDirect(ut);
  }

  // =========================================================
  // 11) 音声
  // =========================================================
  function setLucyVoiceStatus(msg) {
    if (!lucyVoiceAskStatus) return;
    lucyVoiceAskStatus.textContent = String(msg || "");
  }

  function setLucyVoiceBtnLabel(isRecording) {
    if (!lucyVoiceAskBtn) return;
    lucyVoiceAskBtn.textContent = isRecording
      ? getTerm("voiceStop", "停止")
      : getTerm("voiceAsk", "Lucyに質問（音声）");
  }

  function getSpeechRecognitionCtor() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function stopVoiceTracks() {
    try {
      if (!voiceMediaStream) return;
      for (const t of voiceMediaStream.getTracks()) t.stop();
    } catch (_) {}
    voiceMediaStream = null;
  }

  function startBrowserSpeech() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) throw new Error("SpeechRecognition not supported.");

    const rec = new Ctor();
    speechRec = rec;
    speechIsRunning = true;
    lastSpeechFinal = "";

    rec.lang = langToSpeechLocale(getCurrentLang());
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onresult = (ev) => {
      let finalText = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
      }
      finalText = normalizeUserText(finalText);
      if (finalText) lastSpeechFinal = finalText;

      const interim = normalizeUserText(ev.results[ev.results.length - 1][0].transcript);
      setLucyVoiceStatus(interim ? interim : "");
    };

    rec.onerror = (e) => {
      console.error("[speech] error", e);
      setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
    };

    rec.onend = async () => {
      speechIsRunning = false;
      speechRec = null;

      const text = normalizeUserText(lastSpeechFinal);
      if (!text) {
        setLucyVoiceStatus(getTerm("voiceNoResult", "聞き取れませんでした。もう一度お試しください。"));
        setLucyVoiceBtnLabel(false);
        return;
      }

      try {
        setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
        setLucyVoiceBtnLabel(false);
        await sendTextDirect(text);
        setLucyVoiceStatus("");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました"));
      }
    };

    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
    rec.start();
  }

  function stopBrowserSpeech() {
    try {
      if (speechRec) speechRec.stop();
    } catch (_) {}
    speechIsRunning = false;
    speechRec = null;
    setLucyVoiceBtnLabel(false);
  }

  async function startServerVoice() {
    try {
      setLucyVoiceBtnLabel(true);
      voiceIsRecording = true;
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));

      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceMediaRecorder = new MediaRecorder(voiceMediaStream);

      voiceChunks = [];
      voiceMediaRecorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
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
      startBrowserSpeech();
    } else {
      await startServerVoice();
    }
  }

  // =========================================================
  // 12) 初期化（ツアーインフォメーションを開いたタイミングで挨拶）
  // =========================================================
  const isPanelOpen = () => {
    try {
      if (touristInfoBtn && touristInfoBtn.getAttribute("aria-expanded") === "true") return true;
    } catch (_) {}
    try {
      if (recommendSection && !recommendSection.classList.contains("is-collapsed")) return true;
    } catch (_) {}
    return false;
  };

  const isChatEmpty = () => {
    try {
      if (!chatEl) return true;
      if (chatEl.children && chatEl.children.length > 0) return false;
      return String(chatEl.textContent || "").trim() === "";
    } catch (_) {
      return true;
    }
  };

  async function initLucyGreetingIfNeeded() {
    // すでに挨拶済み、またはチャットが既に埋まっている場合は何もしない
    if (lucyGreetingShown) return;
    if (!isChatEmpty()) {
      lucyGreetingShown = true;
      return;
    }

    setLucyVoiceStatus("");
    setSending(true);
    try {
      const data = await callWorker(null);
      if (data.reply) appendLucy(data.reply);
      if (data.nextState) nextState = data.nextState;
      if (data.debug) console.log("[Lucy debug]", data.debug);
      lucyGreetingShown = true;
    } catch (e) {
      appendError("初期化に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  // パネルを開いた直後（言語切替後）に挨拶を出す
  // ※ 開閉の実体は別スクリプト（またはCSS/属性）で行われるため、click後に状態を確認する
  if (touristInfoBtn) {
    touristInfoBtn.addEventListener("click", () => {
      // click直後は aria-expanded / class の反映前の可能性があるので次tickで判定
      setTimeout(() => {
        if (isPanelOpen()) initLucyGreetingIfNeeded();
      }, 0);
    });
  }

  // ページ読み込み時点でパネルが既に開いている場合のみ（例: 直前の状態復元など）挨拶
  setTimeout(() => {
    if (isPanelOpen()) initLucyGreetingIfNeeded();
  }, 0);

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
