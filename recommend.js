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

  // ★ 追加：挨拶を「パネルを開いた時」に1回だけ出すためのフラグ
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
  // 6) UI描画（※DOM構造は元のまま維持）
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

        btn.addEventListener("click", async () => {
          try {
            btn.disabled = true;
            await sendText(label);
          } finally {
            btn.disabled = false;
          }
        });

        return btn;
      };

      for (const c of choices) {
        wrap.appendChild(makeBtn(c));
      }

      wrap.appendChild(makeBtn(getTerm("choiceNeither", "どっちも違う")));

      parts.body.appendChild(wrap);
    }

    return parts;
  }

  function clearChat() {
    chatEl.innerHTML = "";
  }

  function setLucyVoiceStatus(text) {
    if (!lucyVoiceAskStatus) return;
    lucyVoiceAskStatus.textContent = text || "";
  }

  function setLucyVoiceBtnLabel(isActive) {
    if (!lucyVoiceAskBtn) return;

    if (isActive) {
      // ★「話し終えたら送信」：各言語JSONの recommend.voiceSendingAfterTalk を参照
      lucyVoiceAskBtn.textContent = getTerm("voiceSendingAfterTalk", "話し終えたら送信");
    } else {
      // ★既存キー：recommend.voiceBtnIdle
      lucyVoiceAskBtn.textContent = getTerm("voiceBtnIdle", "Lucyに質問（音声）");
    }

    setLucyVoiceStatus("");
  }

  // =========================================================
  // 7) Worker通信
  // =========================================================
  async function postChat(payload) {
    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const ct = res.headers.get("content-type") || "";
    const txt = await res.text();

    if (!res.ok) {
      const err = new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
      err.status = res.status;
      err.body = txt;
      throw err;
    }

    if (ct.includes("application/json")) {
      const p = safeJsonParse(txt);
      if (p.ok) return p.value;
      return { reply: txt };
    }

    const p = safeJsonParse(txt);
    if (p.ok) return p.value;
    return { reply: txt };
  }

  async function sendTextDirect(userText) {
    const payload = {
      userText,
      nextState,
      lang: getCurrentLang(),
    };

    const data = await postChat(payload);
    if (data && typeof data.nextState !== "undefined") nextState = data.nextState;

    const reply = (data && typeof data.reply === "string") ? data.reply : String(data?.reply ?? "");
    appendLucy(reply);
  }

  async function sendText(userText) {
    const t = normalizeUserText(userText);
    if (!t) return;
    appendUser(t);

    setSending(true);
    try {
      await sendTextDirect(t);
    } catch (e) {
      console.error(e);
      appendLucy(`エラー: ${String(e?.message || e)}`);
    } finally {
      setSending(false);
    }
  }

  // =========================================================
  // 8) 挨拶（パネルを開いた時に1回）
  // =========================================================
  async function ensureLucyGreetingIfNeeded() {
    if (lucyGreetingShown) return;
    lucyGreetingShown = true;

    setSending(true);
    try {
      await sendTextDirect("");
    } catch (e) {
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  // =========================================================
  // 9) 音声（browser SpeechRecognition）
  // =========================================================
  function ensureSpeechRec() {
    if (speechRec) return true;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return false;

    const rec = new SR();
    rec.interimResults = true;
    rec.continuous = false;

    rec.onstart = () => {
      speechIsRunning = true;
      lastSpeechFinal = "";
      setLucyVoiceBtnLabel(true);
      // ★ recommend.voiceListening
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
    };

    rec.onresult = async (ev) => {
      try {
        let finalText = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (!r || !r[0]) continue;
          const t = String(r[0].transcript || "");
          if (r.isFinal) finalText += t;
        }

        finalText = normalizeUserText(finalText);
        if (finalText) {
          lastSpeechFinal = finalText;
          // 送信中は statusSending に寄せる（各言語対応済み想定）
          setLucyVoiceStatus(getTerm("statusSending", "認識しました。送信します…"));
          await sendTextDirect(finalText);
          setLucyVoiceStatus("");
        }
      } catch (e) {
        console.error(e);
        // ★ 失敗時は voiceNotHeard に寄せて多言語化優先
        setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
      }
    };

    rec.onerror = (e) => {
      console.warn("[SpeechRecognition] error", e);
      setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
    };

    rec.onend = () => {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);

      if (!lastSpeechFinal) {
        // ★ recommend.voiceNotHeard
        setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
      }
    };

    speechRec = rec;
    return true;
  }

  async function startBrowserSpeech() {
    if (!ensureSpeechRec()) {
      setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
      return;
    }
    try {
      speechRec.lang = langToSpeechLocale(getCurrentLang());
      speechRec.start();
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
      setLucyVoiceBtnLabel(false);
      speechIsRunning = false;
    }
  }

  function stopBrowserSpeech() {
    try { speechRec && speechRec.stop(); } catch (_) {}
  }

  // =========================================================
  // 10) 音声（server upload: MediaRecorder）
  // =========================================================
  function stopVoiceTracks() {
    if (voiceMediaStream) {
      try {
        voiceMediaStream.getTracks().forEach((t) => {
          try { t.stop(); } catch (_) {}
        });
      } catch (_) {}
    }
    voiceMediaStream = null;
  }

  async function startServerVoice() {
    try {
      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      voiceIsRecording = true;

      setLucyVoiceBtnLabel(true);
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));

      voiceMediaRecorder = new MediaRecorder(voiceMediaStream);
      voiceMediaRecorder.ondataavailable = (e) => {
        if (e && e.data && e.data.size > 0) voiceChunks.push(e.data);
      };

      voiceMediaRecorder.onstop = async () => {
        try {
          setLucyVoiceBtnLabel(false);
          voiceIsRecording = false;

          // ★ 解析/送信中：statusSending（各言語に既に存在する想定）
          setLucyVoiceStatus(getTerm("statusSending", "解析中…"));

          const blob = new Blob(voiceChunks, { type: voiceMediaRecorder.mimeType || "audio/webm" });

          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          fd.append("lang", getCurrentLang());

          const res = await fetch(WORKER_VOICE_URL, {
            method: "POST",
            body: fd,
          });

          const txt = await res.text();
          if (!res.ok) {
            console.error("voice upload failed", res.status, txt);
            setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
            return;
          }

          const p = safeJsonParse(txt);
          const recognizedText = p.ok ? (p.value && (p.value.text || p.value.transcript || "")) : "";
          const finalText = normalizeUserText(recognizedText);

          if (!finalText) {
            setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
            return;
          }

          await sendText(finalText);
          setLucyVoiceStatus("");
        } catch (e) {
          console.error(e);
          setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
        } finally {
          stopVoiceTracks();
          voiceChunks = [];
          voiceMediaRecorder = null;
        }
      };

      voiceMediaRecorder.start();
    } catch (e) {
      console.error(e);
      // 許可/非対応などもまず多言語化優先で voiceNotHeard に寄せる
      setLucyVoiceStatus(getTerm("voiceNotHeard", "聞き取れませんでした。もう一度お試しください。"));
      setLucyVoiceBtnLabel(false);
      voiceIsRecording = false;
      stopVoiceTracks();
    }
  }

  function stopServerVoice() {
    try {
      if (voiceMediaRecorder && voiceMediaRecorder.state !== "inactive") {
        voiceMediaRecorder.stop();
      }
    } catch (e) {
      console.warn(e);
    }
  }

  // =========================================================
  // 11) 音声モード切替
  // =========================================================
  async function toggleVoice() {
    if (voiceIsRecording || speechIsRunning) {
      // stop
      if (speechIsRunning) stopBrowserSpeech();
      if (voiceIsRecording) stopServerVoice();
      return;
    }

    // start
    const mode = String(VOICE_MODE || "auto").toLowerCase();
    const canBrowser = !!(window.SpeechRecognition || window.webkitSpeechRecognition);

    if (mode === "browser") {
      await startBrowserSpeech();
      return;
    }
    if (mode === "server") {
      await startServerVoice();
      return;
    }

    // auto
    if (canBrowser) {
      await startBrowserSpeech();
    } else {
      await startServerVoice();
    }
  }

  // =========================================================
  // 12) イベント設定
  // =========================================================
  sendBtn.addEventListener("click", () => {
    const t = normalizeUserText(inputEl.value);
    if (!t) return;
    inputEl.value = "";
    sendText(t);
  });

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendBtn.click();
    }
  });

  // touristInfoBtn が押されたときに recommendSection を表示する場合、挨拶を出す
  if (touristInfoBtn && recommendSection) {
    touristInfoBtn.addEventListener("click", () => {
      try {
        // 表示制御は index.html 側の既存処理に合わせる（ここでは挨拶だけ）
        ensureLucyGreetingIfNeeded();
      } catch (_) {}
    });
  } else {
    // touristInfoBtn がないページでも動くように（何もしない）
  }

  // 初期ボタン文言
  setSending(false);

  // 音声ボタン
  if (lucyVoiceAskBtn) {
    setLucyVoiceBtnLabel(false);
    lucyVoiceAskBtn.addEventListener("click", toggleVoice);
  } else {
    console.warn("[recommend.js] lucyVoiceAskBtn not found.");
  }
})();
