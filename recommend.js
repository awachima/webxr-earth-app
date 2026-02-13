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
 */
(() => {
  "use strict";
  try { console.log("[recommend.js] loaded"); } catch (_) {}

  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

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
    const text = String(rawText || "");
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
      return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>${escapeHtml(
        suffix
      )}`;
    });

    // 3) 改行を <br>
    html = html.replace(/\n/g, "<br>");

    return html;
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

      // ★追加: 「どっちも違う」ボタン
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

  // 音声ボタン（既存のまま。ここは今回の「何も出ない」には無関係）
  // ※ もともとの recommend.js に音声の大きな実装がある場合、
  //   それをここに統合しているなら、その部分はあなたの元ファイルに合わせてください。
})();
