/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat / #lucyVoiceAskBtn) を使って
 *   Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★ 多言語対応:
 * - 言語切り替え (window.currentLang / window.__DD_LANG / localStorage) に動的に追従。
 * - UIテキストは window.i18n.recommend から取得。
 *
 * ★ チャットバブルUI化:
 * - #recommendChat に「msg-row / msg-bubble / msg-meta」DOMを追加して表示する
 * - Lucy(assistant)=左 / You(user)=右
 *
 * ★ 2択クリック対応:
 * - Lucyの返答に「以下でしたらどちらの気分ですか？」＋「・選択肢」が含まれる場合、
 *   バブルの下に候補ボタンを表示し、クリックでその選択肢を送信する。
 *
 * ★ 音声:
 * - browser: SpeechRecognition（途中経過=interim をステータスに表示）
 * - server : MediaRecorder → /voice（途中経過の文字起こしは基本不可）
 *
 * ▼ 重要:
 * - Pages 側に /chat は無いので 405 になります。
 *   必ず Worker の /chat に向けるため、
 *   window.__LUCY_CHAT_URL があればそれを最優先、無ければ下の既定URLを使用します。
 */

(() => {
  "use strict";
  try { console.log("[recommend.js] loaded"); } catch (_) {}

  // =========================================================
  // 1) 設定（★ここだけあなたの環境で変える可能性あり）
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

  // Pages 側に誤爆していたら早めに気づけるように警告
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
    } catch (e) {}
    if (document.documentElement.lang) return document.documentElement.lang;
    return "ja";
  };

  // UIテキスト（i18nの形が複数あり得るので吸収）
  // 1) window.i18n.recommend[key] = "."
  // 2) window.i18n.recommend[lang][key] = "."
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

  // 音声録音用（server mode）
  let voiceMediaStream = null;
  let voiceMediaRecorder = null;
  let voiceChunks = [];
  let voiceIsRecording = false;

  // SpeechRecognition（browser mode）
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

  // Lucyの返答は「安全な範囲でリンクを許可」しつつ、それ以外はテキスト扱いにする
  function sanitizeLucyReplyToHtml(rawText) {
    const original = String(rawText || "");

    // 0) Worker から <a ...> が来る可能性があるので、一旦エスケープ
    let s = escapeHtml(original);

    // 1) http(s)リンクを自動リンク化（既に <a> が来る場合は Worker 側で整形されている想定だが、念のため）
    s = s.replace(
      /(https?:\/\/[^\s<>"']+)/g,
      (m) => `<a href="${m}" target="_blank" rel="noopener noreferrer">${m}</a>`
    );

    // 2) 改行は <br>
    s = s.replace(/\n/g, "<br>");

    // 3) 「・」箇条書きは簡易的に <div> にする（見た目のため）
    //    ※ HTMLタグが見える問題を避けるため、ここでは余計なタグ生成は最小限
    return s;
  }

  function appendBubble(role, who, text, allowHtml) {
    const row = document.createElement("div");
    row.className = `msg-row ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = who;

    const body = document.createElement("div");
    body.className = "msg-body";
    if (allowHtml) {
      body.innerHTML = sanitizeLucyReplyToHtml(text);
    } else {
      body.textContent = text;
    }

    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    chatEl.appendChild(row);

    chatEl.scrollTop = chatEl.scrollHeight;

    return { row, bubble, body };
  }

  function appendLucy(text) {
    const parts = appendBubble("assistant", "Lucy", String(text || ""), true);

    // Lucy返答に「・」が含まれている場合、候補ボタン化を試みる
    // 例:
    // 以下でしたらどちらの気分ですか？
    // ・自然の景色
    // ・街や市場をそぞろ歩きするなど
    // （and/or 「どっちも違う」等）
    try {
      const raw = String(text || "");
      if (!raw.includes("・")) return;

      const lines = raw.split("\n").map((x) => x.trim()).filter(Boolean);
      const choices = lines
        .filter((l) => l.startsWith("・"))
        .map((l) => l.replace(/^・\s*/, "").trim())
        .filter(Boolean);

      if (!choices || choices.length === 0) return;

      const wrap = document.createElement("div");
      wrap.className = "choice-buttons";
      wrap.style.display = "flex";
      wrap.style.flexWrap = "wrap";
      wrap.style.gap = "8px";
      wrap.style.marginTop = "10px";

      const makeBtn = (label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost";
        btn.textContent = label;

        btn.style.padding = "8px 12px";
        btn.style.borderRadius = "999px";
        btn.style.border = "1px solid rgba(0,0,0,0.2)";
        btn.style.background = "rgba(255,255,255,0.95)";
        btn.style.cursor = "pointer";

        btn.addEventListener("mouseenter", () => {
          btn.style.filter = "brightness(0.98)";
        });
        btn.addEventListener("mouseleave", () => {
          btn.style.filter = "none";
        });

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

      // すべての候補をボタン化
      choices.forEach((c) => wrap.appendChild(makeBtn(c)));

      // 「どっちも違う」ボタン（固定）
      wrap.appendChild(makeBtn(getTerm("choiceNeither", "どっちも違う")));

      parts.bubble.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
    } catch (_) {}
  }

  function appendUser(text) {
    appendBubble("user", "You", String(text || ""), false);
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

  function setLucyVoiceStatus(text) {
    if (!lucyVoiceAskStatus) return;
    lucyVoiceAskStatus.textContent = String(text || "");
  }

  function setLucyVoiceBtnLabel(isActive) {
    if (!lucyVoiceAskBtn) return;
    if (isActive) {
      lucyVoiceAskBtn.textContent = getTerm("voiceBtnStop", "音声停止");
    } else {
      lucyVoiceAskBtn.textContent = getTerm("voiceBtnIdle", "Lucyに質問（音声）");
    }
  }

  function stopVoiceTracks() {
    if (voiceMediaStream) {
      try {
        voiceMediaStream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
    }
    voiceMediaStream = null;
  }

  // =========================================================
  // 6) Worker 呼び出し
  // =========================================================
  async function callWorker(userText) {
    const payload = {};
    if (userText) payload.userText = userText;
    if (nextState) payload.state = nextState;

    const lang = getCurrentLang();
    payload.lang = lang;

    const res = await fetch(WORKER_CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
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

  async function sendTextDirect(text) {
    const t = normalizeUserText(text);
    if (!t) return;
    ensurePanelOpenSoftly();
    appendUser(t);

    setSending(true);
    try {
      const data = await callWorker(t);
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
  // 7) 送信処理
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
  // 8) 音声：browser（SpeechRecognition）
  // =========================================================
  function getSpeechRecognitionCtor() {
    const w = window;
    return w.SpeechRecognition || w.webkitSpeechRecognition || null;
  }

  function langToSpeechLocale(lang) {
    const l = String(lang || "ja").toLowerCase();
    if (l.startsWith("ja")) return "ja-JP";
    if (l.startsWith("en")) return "en-US";
    if (l.startsWith("zh")) return "zh-CN";
    if (l.startsWith("hi")) return "hi-IN";
    if (l.startsWith("he")) return "he-IL";
    if (l.startsWith("fa")) return "fa-IR";
    return "ja-JP";
  }

  function ensureSpeechRec() {
    if (speechRec) return true;
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) return false;

    const rec = new Ctor();
    rec.continuous = false;

    // ★ここが重要：途中経過（interim）を受け取れるようにする
    rec.interimResults = true;

    rec.onstart = () => {
      speechIsRunning = true;
      lastSpeechFinal = "";
      setLucyVoiceBtnLabel(true);
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
    };

    // ★途中経過をステータスに表示する（聞き取り中の文字が見えるようになる）
    rec.onresult = async (ev) => {
      try {
        let finalText = "";
        let interimText = "";

        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (!r || !r[0] || !r[0].transcript) continue;

          if (r.isFinal) {
            finalText += (finalText ? " " : "") + r[0].transcript;
          } else {
            interimText += (interimText ? " " : "") + r[0].transcript;
          }
        }

        // 途中経過（聞き取り中の文字）をステータスに表示
        interimText = normalizeUserText(interimText);
        if (interimText) {
          setLucyVoiceStatus(interimText);
        } else if (!lastSpeechFinal) {
          setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
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
      const lang = getCurrentLang();
      speechRec.lang = langToSpeechLocale(lang);
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
  // 9) 音声：server（MediaRecorder → /voice）
  // =========================================================
  async function startServerVoice() {
    try {
      setLucyVoiceStatus(getTerm("voicePrepare", "マイク準備中…"));

      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeCandidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
      ];
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
        setLucyVoiceStatus(getTerm("voiceRecording", "録音中…（もう一度押すと送信）"));
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
  // 10) 音声トグル（ボタン）
  // =========================================================
  function resolveVoiceMode() {
    const m = String(VOICE_MODE || "auto").toLowerCase();
    if (m === "browser") return "browser";
    if (m === "server") return "server";

    // auto
    const hasSR = !!getSpeechRecognitionCtor();
    return hasSR ? "browser" : "server";
  }

  async function toggleVoice() {
    if (sendBtn.disabled) return;

    // 動作中なら停止
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
  // 11) 初期化
  // =========================================================
  (async () => {
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
