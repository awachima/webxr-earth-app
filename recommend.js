/**
 * recommend.js
 * - index.html の既存UI (#recommendInput / #recommendSend / #recommendChat) を使って
 *   Cloudflare Worker の /chat に POST し、reply と nextState を表示する。
 *
 * ★ 多言語対応・修正版:
 * - 言語切り替え (window.currentLang) に動的に追従。
 * - UIテキストを window.i18n.recommend から取得。
 *
 * ★ チャットバブルUI化:
 * - #recommendChat に「msg-row / msg-bubble / msg-meta」DOMを追加して表示する
 * - Lucy(assistant)=左 / You(user)=右
 *
 * ★ 2択クリック対応:
 * - Lucyの返答に「以下でしたらどちらの気分ですか？」＋「・選択肢×2以上」が含まれる場合、
 *   バブルの下にボタンを表示し、クリックでその選択肢を送信する。
 *
 * ★ 音声質問ボタン対応（今回追加）:
 * - #lucyVoiceAskBtn をクリックすると、
 *   - VOICE_MODE=auto: ブラウザSTTが使えればそれを使う / 使えなければサーバーSTT（録音→/voice）
 *   - VOICE_MODE=browser: ブラウザSTTのみ
 *   - VOICE_MODE=server: サーバーSTTのみ（MediaRecorderで録音→/voice）
 */

(() => {
  "use strict";
  try { console.log("[recommend.js] loaded"); } catch (_) {}

  // =========================================================
  // 1) 設定
  // =========================================================

  // ★優先順位:
  // 1) window.__LUCY_CHAT_URL があればそれ
  // 2) 既定の Worker URL
  const WORKER_CHAT_URL = (() => {
    try {
      if (typeof window !== "undefined" && window.__LUCY_CHAT_URL) {
        return String(window.__LUCY_CHAT_URL);
      }
    } catch (_) {}
    return "https://lucy-recommend.awachima7.workers.dev/chat";
  })();

  // voice endpoint は /chat → /voice の派生（明示指定があればそれを優先）
  const WORKER_VOICE_URL = (() => {
    try {
      if (typeof window !== "undefined" && window.__LUCY_VOICE_URL) {
        return String(window.__LUCY_VOICE_URL);
      }
    } catch (_) {}

    const s = String(WORKER_CHAT_URL || "");
    if (/\/chat(\?.*)?$/i.test(s)) return s.replace(/\/chat(\?.*)?$/i, "/voice");
    return s.replace(/\/+$/, "") + "/voice";
  })();

  // "auto" | "browser" | "server"
  const VOICE_MODE = (() => {
    try {
      if (typeof window !== "undefined" && window.__LUCY_VOICE_MODE) {
        return String(window.__LUCY_VOICE_MODE);
      }
    } catch (_) {}
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

  // SpeechRecognition 用の言語コード寄せ（必要なら増やす）
  function mapToSpeechLang(lang) {
    const l = String(lang || "").toLowerCase();
    if (l === "ja") return "ja-JP";
    if (l === "en") return "en-US";
    if (l === "zh") return "zh-CN";
    if (l === "hi") return "hi-IN";
    if (l === "fa") return "fa-IR";
    if (l === "he") return "he-IL";
    return l;
  }

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

    // 0) Worker から <a ...>...</a> が来る場合がある（それを textContent で見せないため）
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
      const trimmed = m.replace(/[)\]、。．，.]+$/g, (x) => x);
      const suffix = m.slice(trimmed.length);
      const safe = escapeHtml(trimmed);
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>${escapeHtml(suffix)}`;
    });

    // 3) 退避した a タグを復元（すでにサニタイズ済み）
    for (const a of anchorTokens) {
      const tokenRe = new RegExp(escapeRegExp(a.token), "g");
      html = html.replace(tokenRe, a.html);
    }

    // 4) 改行は <br> に
    html = html.replace(/\r?\n/g, "<br>");

    return html;
  }

  function sanitizeAnchorHtml(anchorHtml) {
    try {
      // href と表示テキストだけを許可（それ以外は落とす）
      const hrefMatch = anchorHtml.match(/\bhref\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i);
      const hrefRaw = hrefMatch ? (hrefMatch[2] || hrefMatch[3] || hrefMatch[4] || "") : "";
      const href = String(hrefRaw || "").trim();

      // http/https のみ許可
      if (!/^https?:\/\//i.test(href)) {
        // 許可しないリンクはテキストとして表示
        return escapeHtml(stripTags(anchorHtml));
      }

      // aタグ内部の表示テキスト（タグは除去）
      const label = stripTags(anchorHtml).trim() || href;

      const safeHref = escapeHtml(href);
      const safeLabel = escapeHtml(label);

      return `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${safeLabel}</a>`;
    } catch (e) {
      // 万一失敗したら、タグを落としてテキスト化
      return escapeHtml(stripTags(anchorHtml));
    }
  }

  function stripTags(html) {
    return String(html || "").replace(/<\/?[^>]+>/g, "");
  }

  function escapeRegExp(s) {
    return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // 返答テキストから、絞り込み候補の箇条書きだけ抽出する
  // - 「・」や「-」などの箇条書きを候補として拾う
  // - URLを含む行（=ツアー候補）は拾わない
  function extractChoicesFromLucyReply(rawText) {
    const text = String(rawText || "");
    // URL行が混ざる場合はボタン化しないため、URL含む行は除外
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

    const choices = [];
    for (const line of lines) {
      // URLがあれば候補ではない（ツアーの提案）
      if (/https?:\/\//i.test(line)) continue;

      // 箇条書きっぽい記号
      const m =
        line.match(/^[・\-\*]\s*(.+)$/) ||
        line.match(/^\d+\.\s*(.+)$/) ||
        line.match(/^\(\d+\)\s*(.+)$/);

      if (!m) continue;

      const c = String(m[1] || "").trim();
      if (!c) continue;

      // 余計な末尾記号を落とす
      const cleaned = c.replace(/[：:\-–—]\s*$/g, "").trim();
      if (!cleaned) continue;

      // 重複排除（同じ候補が複数行あるとボタンが増えるので）
      if (!choices.includes(cleaned)) choices.push(cleaned);
    }

    // 2個以上ないと「絞り込み候補」っぽくないので null
    if (choices.length < 2) return null;
    return { choices };
  }

  // =========================================================
  // 5) UI描画（チャットバブル）
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

    if (isHtml) {
      body.innerHTML = content;
    } else {
      body.textContent = content;
    }

    bubble.appendChild(meta);
    bubble.appendChild(body);
    row.appendChild(bubble);
    chatEl.appendChild(row);

    chatEl.scrollTop = chatEl.scrollHeight;

    // 追加: 呼び出し側でボタン等を付けられるように返す
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
      // CSSが無くても最低限見えるように軽くスタイル
      wrap.style.marginTop = "10px";
      wrap.style.display = "flex";
      wrap.style.gap = "8px";
      wrap.style.flexWrap = "wrap";

      const makeBtn = (label) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "lucy-choice-btn";
        btn.textContent = label;

        // CSSが無くてもボタンらしくする
        btn.style.padding = "8px 10px";
        btn.style.borderRadius = "10px";
        btn.style.border = "1px solid rgba(0,0,0,0.15)";
        btn.style.background = "#fff";
        btn.style.cursor = "pointer";
        btn.style.fontSize = "14px";

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

      // 「どっちも違う」ボタン
      wrap.appendChild(makeBtn(getTerm("choiceNeither", "どっちも違う")));

      // バブル内（本文の下）にボタンを追加
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

  function isSpeechRecognitionAvailable() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
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

  // 文字列をそのまま送信するためのヘルパー（音声→テキスト送信で使う）
  async function sendTextDirect(text) {
    const t = normalizeUserText(text);
    if (!t) return;
    inputEl.value = t;
    await onSend();
  }

  // =========================================================
  // 8) 音声（ブラウザSTT）
  // =========================================================
  function startBrowserSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      throw new Error("SpeechRecognition not available");
    }

    if (speechRec) {
      try { speechRec.onresult = null; speechRec.onerror = null; speechRec.onend = null; } catch (_) {}
      speechRec = null;
    }

    const rec = new SR();
    rec.lang = mapToSpeechLang(getCurrentLang());
    rec.interimResults = false;
    rec.continuous = false;

    speechIsRunning = true;
    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));

    rec.onresult = async (ev) => {
      try {
        const text = ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : "";
        const normalized = normalizeUserText(text);
        if (!normalized) {
          setLucyVoiceStatus(getTerm("voiceNoSpeech", "音声が認識できませんでした。もう一度お試しください。"));
          return;
        }
        setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
        await sendTextDirect(normalized);
        setLucyVoiceStatus("");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました。"));
      }
    };

    rec.onerror = (ev) => {
      console.error("[SpeechRecognition error]", ev);
      setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました。"));
    };

    rec.onend = () => {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);
      // onresultで送信しているので、ここでは過剰にメッセージを出さない
      if (!voiceIsRecording) {
        // 何も送られなかった場合の保険
        // setLucyVoiceStatus("");
      }
    };

    speechRec = rec;
    rec.start();
  }

  function stopBrowserSTT() {
    try {
      if (speechRec && speechIsRunning) speechRec.stop();
    } catch (_) {}
    speechIsRunning = false;
    setLucyVoiceBtnLabel(false);
  }

  // =========================================================
  // 9) 音声（サーバーSTT：録音→/voice）
  // =========================================================
  async function startServerVoice() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error("getUserMedia not supported");
    }

    // すでに録音中なら無視
    if (voiceIsRecording) return;

    setLucyVoiceStatus(getTerm("voiceMicRequest", "マイクの使用を許可してください…"));

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceMediaStream = stream;

    voiceChunks = [];
    let mimeType = "";

    // できれば webm
    if (window.MediaRecorder) {
      const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      for (const c of candidates) {
        if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(c)) {
          mimeType = c;
          break;
        }
      }
    }

    const mr = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    voiceMediaRecorder = mr;

    mr.ondataavailable = (ev) => {
      try {
        if (ev.data && ev.data.size > 0) voiceChunks.push(ev.data);
      } catch (_) {}
    };

    mr.onerror = (ev) => {
      console.error("[MediaRecorder error]", ev);
      setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました。"));
    };

    mr.onstart = () => {
      voiceIsRecording = true;
      setLucyVoiceBtnLabel(true);
      setLucyVoiceStatus(getTerm("voiceRecording", "録音中…（もう一度押すと停止）"));
    };

    mr.onstop = async () => {
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
      stopVoiceTracks();

      try {
        setLucyVoiceStatus(getTerm("voiceUploading", "送信中…"));

        const blob = new Blob(voiceChunks, { type: mimeType || "audio/webm" });
        const fd = new FormData();
        fd.append("lang", getCurrentLang());
        fd.append("audio", blob, "voice.webm");

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

        const text = normalizeUserText(parsed.value && parsed.value.text ? parsed.value.text : "");
        if (!text) {
          setLucyVoiceStatus(getTerm("voiceNoSpeech", "音声が認識できませんでした。もう一度お試しください。"));
          return;
        }

        setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
        await sendTextDirect(text);
        setLucyVoiceStatus("");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました。"));
      } finally {
        voiceChunks = [];
        voiceMediaRecorder = null;
      }
    };

    mr.start();
  }

  function stopServerVoice() {
    try {
      if (voiceMediaRecorder && voiceIsRecording) voiceMediaRecorder.stop();
    } catch (_) {
      // 失敗したら強制停止
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
      stopVoiceTracks();
    }
  }

  // =========================================================
  // 10) 音声：トグル制御
  // =========================================================
  async function toggleVoice() {
    // 送信中は触らない
    if (sendBtn.disabled) return;

    // すでに動作中なら停止
    if (speechIsRunning) {
      stopBrowserSTT();
      setLucyVoiceStatus("");
      return;
    }
    if (voiceIsRecording) {
      stopServerVoice();
      // onstop 側で送信する
      return;
    }

    ensurePanelOpenSoftly();

    const mode = String(VOICE_MODE || "auto").toLowerCase();
    const canBrowser = isSpeechRecognitionAvailable();

    try {
      if (mode === "browser") {
        if (!canBrowser) {
          setLucyVoiceStatus(getTerm("voiceBrowserUnavailable", "この環境ではブラウザ音声認識が利用できません。"));
          return;
        }
        startBrowserSTT();
        return;
      }

      if (mode === "server") {
        await startServerVoice();
        return;
      }

      // auto
      if (canBrowser) {
        startBrowserSTT();
        return;
      }
      await startServerVoice();
    } catch (e) {
      console.error(e);
      setLucyVoiceBtnLabel(false);
      setLucyVoiceStatus(getTerm("voiceFailed", "音声処理に失敗しました。"));
      // 念のため停止
      stopBrowserSTT();
      stopServerVoice();
      stopVoiceTracks();
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

  // ★ここが今回の本題：音声ボタンのイベントを付ける
  if (lucyVoiceAskBtn) {
    lucyVoiceAskBtn.addEventListener("click", () => {
      toggleVoice();
    });
  } else {
    console.warn("[recommend.js] lucyVoiceAskBtn not found.");
  }
})();
