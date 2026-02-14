/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 * Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★ 多言語対応・修正版:
 * - 言語切り替え (window.currentLang) に動的に追従。
 * - UIテキストを window.i18n.recommend から取得。
 *
 * ★ チャットバブルUI化:
 * - #recommendChat に「msg-row / msg-bubble / msg-meta」DOMを追加して表示する
 * - Lucy(assistant)=左 / You(user)=右
 *
 * ★ 2択クリック対応（今回追加）:
 * - Lucyの返答に「以下でしたらどちらの気分ですか？」＋「・選択肢×2」が含まれる場合、
 *   バブルの下に2つのボタンを表示し、クリックでその選択肢を送信する。
 * - さらに「どっちも違う」ボタンも追加する（3択）
 */

(() => {
  "use strict";

  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL = (() => {
    if (typeof window !== "undefined" && window.__LUCY_WORKER_CHAT_URL) return String(window.__LUCY_WORKER_CHAT_URL);
    // 既存のURLに合わせてください（例: "https://lucy-recommend.awachima7.workers.dev/chat"）
    return "/chat";
  })();

  // /chat をベースに /voice を組み立てる
  const WORKER_VOICE_URL = (() => {
    const s = String(WORKER_CHAT_URL || "");
    if (!s) return "/voice";
    if (/\/voice(\?.*)?$/i.test(s)) return s;
    if (/\/chat(\?.*)?$/i.test(s)) return s.replace(/\/chat(\?.*)?$/i, "/voice");
    return s.replace(/\/+$/, "") + "/voice";
  })();

  const VOICE_MODE = (() => {
    if (typeof window !== "undefined" && window.__LUCY_VOICE_MODE) return String(window.__LUCY_VOICE_MODE);
    return "auto";
  })();

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

  // 翻訳ヘルパー（i18nの形が複数あり得るので吸収）
  // 想定:
  // 1) window.i18n.recommend[key] = "..."
  // 2) window.i18n.recommend[lang][key] = "..."
  const getTerm = (key, def) => {
    try {
      const lang = getCurrentLang();
      const rec = window.i18n && window.i18n.recommend;
      if (!rec) return def;

      // 2) 多言語辞書形式
      if (rec[lang] && rec[lang][key]) return rec[lang][key];
      if (rec.ja && rec.ja[key]) return rec.ja[key];

      // 1) フラット形式
      if (rec[key]) return rec[key];
    } catch (_) {}
    return def;
  };

  // =========================================================
  // 2) DOM取得
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
  // 3) 内部状態
  // =========================================================
  let nextState = null;

  // 音声録音用
  let voiceMediaStream = null;
  let voiceMediaRecorder = null;
  let voiceChunks = [];
  let voiceIsRecording = false;

  // SpeechRecognition
  let speechRec = null;
  let speechIsRunning = false;

  // =========================================================
  // 4) ユーティリティ
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

      if (sendBtn.dataset._prevText) {
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

  // Lucyの返答は「安全な範囲でリンクを許可」しつつ、それ以外はテキスト扱いにする
  function sanitizeLucyReplyToHtml(rawText) {
    const original = String(rawText || "");

    // 0) Worker から <a ...></a> が来る場合がある（それを textContent で見せないため）
    //    まず「安全な a タグ」だけをプレースホルダとして退避し、
    //    それ以外は従来どおりエスケープ → URLリンク化 → 改行 <br> の順でHTML化する。
    const anchorTokens = [];
    let text = original.replace(/<a\b[\s\S]*?<\/a>/gi, (m) => {
      const safe = sanitizeAnchorHtml(m);
      const token = `__ANCHOR_TOKEN_${anchorTokens.length}__`;
      anchorTokens.push({ token, html: safe });
      return token;
    });

    // 1) まずエスケープ
    let html = escapeHtml(text);

    // 2) URL をリンク化（http/httpsのみ）
    //    ただし、末尾の句読点などはリンクに含めない
    const urlRe = /(https?:\/\/[^\s<>"']+)/g;
    html = html.replace(urlRe, (m) => {
      // 末尾に付くことがある記号を落とす
      const trimmed = m.replace(/[)\]、。．，,;:!！?？]+$/g, "");
      const tail = m.slice(trimmed.length);
      const safeUrl = escapeHtml(trimmed);
      return `<a href="${safeUrl}" target="_blank" rel="noopener">${safeUrl}</a>${escapeHtml(tail)}`;
    });

    // 3) 改行を <br> に
    html = html.replace(/\n/g, "<br>");

    // 4) 退避した安全な a タグを戻す
    for (const t of anchorTokens) {
      html = html.replaceAll(escapeHtml(t.token), t.html);
      html = html.replaceAll(t.token, t.html);
    }

    return html;
  }

  function sanitizeAnchorHtml(anchorHtml) {
    try {
      const div = document.createElement("div");
      div.innerHTML = anchorHtml;
      const a = div.querySelector("a");
      if (!a) return escapeHtml(anchorHtml);

      const href = a.getAttribute("href") || "";
      const text = a.textContent || href;

      // http/https のみ許可
      if (!/^https?:\/\//i.test(href)) {
        return escapeHtml(text);
      }

      const safeHref = escapeHtml(href);
      const safeText = escapeHtml(text);
      return `<a href="${safeHref}" target="_blank" rel="noopener">${safeText}</a>`;
    } catch (_) {
      return escapeHtml(anchorHtml);
    }
  }

  function nowTimeString() {
    try {
      const d = new Date();
      const hh = String(d.getHours()).padStart(2, "0");
      const mm = String(d.getMinutes()).padStart(2, "0");
      return `${hh}:${mm}`;
    } catch (_) {
      return "";
    }
  }

  // =========================================================
  // 4.5) バブルUI: append
  // =========================================================
  function appendBubble(role, name, rawText, allowHtml) {
    const row = document.createElement("div");
    row.className = `msg-row ${role === "user" ? "user" : "assistant"}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

    const meta = document.createElement("div");
    meta.className = "msg-meta";
    meta.textContent = `${name} ・ ${nowTimeString()}`;

    const body = document.createElement("div");
    body.className = "msg-body";

    if (allowHtml) {
      body.innerHTML = sanitizeLucyReplyToHtml(rawText);
    } else {
      body.textContent = String(rawText || "");
    }

    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    chatEl.appendChild(row);

    chatEl.scrollTop = chatEl.scrollHeight;

    return { row, bubble, meta, body };
  }

  const appendLucy = (text) => {
    // Lucyはリンク許可
    const parts = appendBubble("assistant", "Lucy", text, true);

    // 2択を検出してボタン化
    // 例:
    // 以下でしたらどちらの気分ですか？
    // ・〇〇
    // ・〇〇
    try {
      const s = String(text || "");
      const lines = s.split("\n").map((x) => x.trim()).filter(Boolean);
      if (lines.length >= 3) {
        const hasPrompt = /どちらの気分ですか/.test(lines[0]) || /以下でしたらどちら/.test(lines[0]);
        if (!hasPrompt) return;

        const choices = [];
        for (const ln of lines.slice(1)) {
          const m = ln.match(/^・\s*(.+)$/);
          if (m && m[1]) choices.push(m[1].trim());
        }
        if (choices.length < 2) return;

        const wrap = document.createElement("div");
        wrap.className = "choice-buttons";
        wrap.style.display = "flex";
        wrap.style.flexWrap = "wrap";
        wrap.style.gap = "8px";
        wrap.style.marginTop = "10px";

        const makeBtn = (label) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = label;
          btn.style.border = "1px solid rgba(0,0,0,0.14)";
          btn.style.borderRadius = "10px";
          btn.style.padding = "8px 10px";
          btn.style.cursor = "pointer";
          btn.style.background = "#fff";
          btn.style.font = "inherit";

          btn.addEventListener("mouseenter", () => {
            btn.style.filter = "brightness(0.98)";
          });
          btn.addEventListener("mouseleave", () => {
            btn.style.filter = "none";
          });

          btn.addEventListener("click", async () => {
            // 送信中は無視
            if (sendBtn.disabled) return;

            // クリック後は二重送信防止のため無効化
            try {
              const all = wrap.querySelectorAll("button");
              all.forEach((b) => (b.disabled = true));
            } catch (_) {}

            // UI上は「ユーザーが選んだ」として、そのテキストを送信
            inputEl.value = label;
            await onSend();
          });

          return btn;
        };

        // すべての候補をボタン化（2段目で大量に出てもOK）
        choices.forEach((c) => wrap.appendChild(makeBtn(c)));

        // ★追加: 「どっちも違う」ボタン
        wrap.appendChild(makeBtn(getTerm("choiceNeither", "どっちも違う")));

        // バブル内（本文の下）にボタンを追加
        parts.bubble.appendChild(wrap);

        chatEl.scrollTop = chatEl.scrollHeight;
      }
    } catch (_) {}
  };

  const appendUser = (text) => {
    appendBubble("user", "You", text, false);
  };

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
  // 5) Worker 呼び出し
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
  // 7) 初期化
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

  sendBtn.addEventListener("click", onSend);
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
      ev.preventDefault();
      onSend();
    }
  });


  // =========================================================
  // 8) 音声ボタン（Lucyに質問（音声））
  // =========================================================
  // 目的:
  // - lucyVoiceAskBtn を押すと録音開始 → もう一度押すと停止 → /voice に送信
  // - Quest/Android は index.html 側で window.__LUCY_VOICE_MODE="server" を強制
  // - PC/Chrome は SpeechRecognition が使える場合はそれを優先（VOICE_MODE="auto" の時）
  //
  // 注意:
  // - Worker 側 readVoiceInput は multipart/form-data で "audio" / "state" / "lang" を受け取れる
  // - ここでは最も堅牢な multipart 送信を採用

  function buildVoiceFormData(audioBlob) {
    const fd = new FormData();
    const lang = getCurrentLang();

    // file 名は任意。Worker 側は file.type と arrayBuffer を見る
    const filename = "voice.webm";
    fd.append("audio", audioBlob, filename);

    try {
      if (nextState) fd.append("state", JSON.stringify(nextState));
    } catch (_) {}

    fd.append("lang", lang);
    return fd;
  }

  async function callVoiceWorkerWithBlob(audioBlob) {
    const fd = buildVoiceFormData(audioBlob);

    const res = await fetch(WORKER_VOICE_URL, {
      method: "POST",
      body: fd,
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

  function canUseSpeechRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    return !!SR;
  }

  function stopSpeechRecognition() {
    if (!speechRec) return;
    try { speechRec.onresult = null; } catch (_) {}
    try { speechRec.onerror = null; } catch (_) {}
    try { speechRec.onend = null; } catch (_) {}
    try { speechRec.stop(); } catch (_) {}
    speechRec = null;
    speechIsRunning = false;
  }

  async function startSpeechRecognitionOnce() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error("SpeechRecognition not supported.");

    stopSpeechRecognition();

    const lang = getCurrentLang();

    return await new Promise((resolve, reject) => {
      const rec = new SR();
      speechRec = rec;

      rec.lang = lang === "ja" ? "ja-JP" : lang; // ざっくり。必要ならここを拡張
      rec.interimResults = false;
      rec.maxAlternatives = 1;

      rec.onresult = (ev) => {
        try {
          const t = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : "";
          resolve(String(t || "").trim());
        } catch (e) {
          reject(e);
        }
      };

      rec.onerror = (ev) => {
        reject(new Error(ev.error || "SpeechRecognition error"));
      };

      rec.onend = () => {
        // onresult が来ずに end した場合
        if (speechIsRunning) {
          // ここでは resolve せず reject で「無音/キャンセル」を知らせる
          reject(new Error(getTerm("voiceNoInput", "音声が検出できませんでした")));
        }
      };

      try {
        speechIsRunning = true;
        rec.start();
      } catch (e) {
        reject(e);
      }
    }).finally(() => {
      speechIsRunning = false;
      try { if (speechRec) speechRec.stop(); } catch (_) {}
      speechRec = null;
    });
  }

  async function startMediaRecorder() {
    stopVoiceTracks();
    voiceChunks = [];

    const constraints = { audio: true, video: false };
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    voiceMediaStream = stream;

    // mimeType は環境によって対応が違うので、対応してるものを選ぶ
    const candidates = [
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg;codecs=opus",
      "audio/ogg",
    ];

    let mimeType = "";
    for (const c of candidates) {
      try {
        if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) {
          mimeType = c;
          break;
        }
      } catch (_) {}
    }

    const recorder = mimeType
      ? new MediaRecorder(stream, { mimeType })
      : new MediaRecorder(stream);

    voiceMediaRecorder = recorder;

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
    };

    recorder.start();
    voiceIsRecording = true;
  }

  async function stopMediaRecorderAndGetBlob() {
    if (!voiceMediaRecorder) return null;

    const recorder = voiceMediaRecorder;

    const blob = await new Promise((resolve) => {
      recorder.onstop = () => {
        try {
          const type = recorder.mimeType || (voiceChunks[0] && voiceChunks[0].type) || "audio/webm";
          resolve(new Blob(voiceChunks, { type }));
        } catch (_) {
          resolve(new Blob(voiceChunks));
        }
      };

      try { recorder.stop(); } catch (_) { resolve(null); }
    });

    voiceIsRecording = false;
    voiceMediaRecorder = null;
    voiceChunks = [];
    stopVoiceTracks();

    return blob;
  }

  async function onLucyVoiceAskClick() {
    if (!lucyVoiceAskBtn) return;
    if (sendBtn.disabled) return; // 送信中は無視

    ensurePanelOpenSoftly();

    // すでに録音/認識中なら「停止」扱い
    if (voiceIsRecording) {
      setLucyVoiceStatus(getTerm("voiceSending", "送信中…"));
      setLucyVoiceBtnLabel(false);
      setSending(true);
      try {
        const blob = await stopMediaRecorderAndGetBlob();
        if (!blob || blob.size === 0) {
          throw new Error(getTerm("voiceNoInput", "音声が検出できませんでした"));
        }

        const data = await callVoiceWorkerWithBlob(blob);

        // transcript をユーザー発言として表示 → reply 表示
        if (data.transcript) appendUser(String(data.transcript));
        if (data.reply) appendLucy(data.reply);
        if (data.nextState) nextState = data.nextState;
        if (data.debug) console.log("[Lucy debug]", data.debug);

        setLucyVoiceStatus("");
      } catch (e) {
        appendError(getTerm("voiceFailed", "音声の送信に失敗しました"), e.message);
        console.error(e);
        setLucyVoiceStatus("");
      } finally {
        setSending(false);
        setLucyVoiceBtnLabel(false);
      }
      return;
    }

    if (speechIsRunning) {
      // 念のため止める
      stopSpeechRecognition();
      setLucyVoiceStatus("");
      setLucyVoiceBtnLabel(false);
      return;
    }

    // 開始
    setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
    setLucyVoiceBtnLabel(true);

    const mode = String(VOICE_MODE || "auto");

    // auto: SpeechRecognition が使えるならそっち、なければ server
    const useSpeech = (mode === "auto" || mode === "speech") && canUseSpeechRecognition();
    const useServer = (mode === "server") || !useSpeech;

    if (useSpeech) {
      setSending(true);
      try {
        const transcript = await startSpeechRecognitionOnce();

        setLucyVoiceStatus("");
        setLucyVoiceBtnLabel(false);

        if (!transcript) {
          throw new Error(getTerm("voiceNoInput", "音声が検出できませんでした"));
        }

        // UI にはユーザー発言として表示
        appendUser(transcript);

        const data = await callWorker(transcript);
        if (data.reply) appendLucy(data.reply);
        if (data.nextState) nextState = data.nextState;
        if (data.debug) console.log("[Lucy debug]", data.debug);
      } catch (e) {
        appendError(getTerm("voiceFailed", "音声の送信に失敗しました"), e.message);
        console.error(e);
      } finally {
        setSending(false);
        setLucyVoiceStatus("");
        setLucyVoiceBtnLabel(false);
      }
      return;
    }

    if (useServer) {
      try {
        await startMediaRecorder();
        // 状態は「録音中」。停止は次回クリックで行う
        setLucyVoiceStatus(getTerm("voiceRecording", "録音中…もう一度押すと送信します"));
      } catch (e) {
        setLucyVoiceStatus("");
        setLucyVoiceBtnLabel(false);

        // 権限がない/拒否など
        appendError(getTerm("voicePermission", "マイクの許可が必要です"), e.message);
        console.error(e);
      }
      return;
    }
  }

  // ラベル初期化
  setLucyVoiceBtnLabel(false);
  setLucyVoiceStatus("");

  if (lucyVoiceAskBtn) {
    lucyVoiceAskBtn.addEventListener("click", onLucyVoiceAskClick);
  }


  // 音声ボタン（既存のまま。ここは今回の「何も出ない」には無関係）
  // ※ もともとの recommend.js に音声の大きな実装がある場合、
  //   それをここに統合しているなら、その部分はあなたの元ファイルに合わせてください。
})();
