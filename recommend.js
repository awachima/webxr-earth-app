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
 * ★ 絞り込み選択肢のボタン化:
 * - Lucyの返答が「選ぶ系の質問」＋「リンク無しの箇条書き（2件以上）」のときだけボタンを出す
 * - ただし、候補にリンク（<a> / http(s)）が混ざっている場合は「ツアー提案」なのでボタン化しない
 *
 * ★ 今回追加（停止対策）:
 * - 「うーん、それではこういうのはいかがでしょう？」等で“提案の中身が返っていない”場合に限り、
 *   自動で「ほかには」を1回だけ追送信して次の提案を引き出す（無限ループ防止あり）
 */
(() => {
  "use strict";

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

  // 翻訳ヘルパー
  const getTerm = (key, def) => {
    if (window.i18n && window.i18n.recommend && window.i18n.recommend[key]) {
      return window.i18n.recommend[key];
    }
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

  // 「提案します」だけ言って中身が来ないケースの自動追送信ガード
  let autoContinueLock = false;
  let autoContinueLastAt = 0;

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
        Array.from(node.childNodes).forEach((c) => walk(c, out));
      }
    }

    const out = [];
    Array.from(root.childNodes).forEach((n) => walk(n, out));
    return out.join("");
  }

  // =========================================================
  // 4.4) 絞り込み用の選択肢抽出
  // =========================================================
  function extractFilterChoicesFromLucyReply(rawText) {
    const t = String(rawText || "").replace(/\r\n/g, "\n");

    // 誤爆防止：「選ぶ」系の問いかけが含まれること
    const hasQuestion =
      /どちらの気分ですか[？\?]/.test(t) ||
      /どちらの気分ですか$/.test(t) ||
      /どれがお好みでしょうか[？\?]/.test(t) ||
      /どれがお好みですか[？\?]/.test(t) ||
      /この中でしたらどれがお好み/.test(t) ||
      /どれが良い/.test(t) ||
      /どれがいい/.test(t);

    if (!hasQuestion) return null;

    const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);

    const bullets = [];
    for (const line of lines) {
      const m = line.match(/^(?:[・•\-]|(?:\u2022))\s*(.+)$/);
      if (m && m[1]) {
        const v = m[1].trim();
        if (v) bullets.push(v);
      }
    }

    if (bullets.length < 2) return null;

    // 候補にリンクが混ざっているなら、ボタン化しない（ツアー提案扱い）
    const joined = bullets.join("\n");
    if (/<\s*a\b/i.test(joined) || /https?:\/\//i.test(joined)) return null;

    return bullets;
  }

  // 「どっちも違う」ボタンの文言は、日本語だけは固定（i18n誤設定事故を防止）
  function getNeitherLabel() {
    const lang = getCurrentLang();
    if (lang === "ja") return "どっちも違う";
    return getTerm("choiceNeither", "Neither");
  }

  // =========================================================
  // 4.4b) 「提案します」だけで止まるケースの検知 → 自動で「ほかには」を1回だけ送る
  // =========================================================
  function shouldAutoContinue(rawText) {
    const t = String(rawText || "").replace(/\r\n/g, "\n").trim();
    if (!t) return false;

    // 近すぎる連続実行を抑制（念のため）
    const now = Date.now();
    if (autoContinueLock) return false;
    if (now - autoContinueLastAt < 1500) return false;

    // すでにリスト（箇条書き/リンク）があるなら、止まってないので追送しない
    const hasBulletLine = /^(?:\s*[・•\-]|\s*\u2022)\s+.+$/m.test(t);
    const hasLink = /<\s*a\b/i.test(t) || /https?:\/\//i.test(t);
    if (hasBulletLine || hasLink) return false;

    // 「提案します」っぽいのに中身が無い時だけ
    const looksLikeOffering =
      /こういうのはいかがでしょう/.test(t) ||
      /こちらはいかがでしょう/.test(t) ||
      /いかがでしょうか/.test(t) ||
      /おすすめです/.test(t);

    if (!looksLikeOffering) return false;

    // 「質問を続けたい」系（=止まりではない）には反応しない
    const looksLikeAskingMore =
      /教えていただけますか/.test(t) ||
      /どんな気分/.test(t) ||
      /差し支えなければ/.test(t);

    if (looksLikeAskingMore) return false;

    return true;
  }

  function getMoreLabel() {
    const lang = getCurrentLang();
    if (lang === "ja") return "ほかには";
    return getTerm("more", "more");
  }

  async function autoContinueOnce() {
    autoContinueLock = true;
    autoContinueLastAt = Date.now();

    // 少しだけ遅延（描画が落ち着いてから送る）
    setTimeout(async () => {
      try {
        if (sendBtn.disabled) return;
        inputEl.value = getMoreLabel();
        await onSend();
      } finally {
        // 次の返信後に再度必要な時だけ動くように解放（時間でも解放）
        setTimeout(() => {
          autoContinueLock = false;
        }, 1200);
      }
    }, 0);
  }

  // =========================================================
  // 4.5) バブルUI：ログ追加
  // =========================================================
  function appendBubble(role, label, content, isHtml) {
    const row = document.createElement("div");
    row.className = `msg-row ${role}`;

    const bubble = document.createElement("div");
    bubble.className = "msg-bubble";

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

    // 1) 絞り込み候補ボタン
    const choices = extractFilterChoicesFromLucyReply(rawText);
    if (choices && choices.length >= 2) {
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

        btn.addEventListener("mouseenter", () => (btn.style.filter = "brightness(0.98)"));
        btn.addEventListener("mouseleave", () => (btn.style.filter = "none"));

        btn.addEventListener("click", async () => {
          if (sendBtn.disabled) return;

          // 二重送信防止
          try {
            wrap.querySelectorAll("button").forEach((b) => (b.disabled = true));
          } catch (_) {}

          inputEl.value = label;
          await onSend();
        });

        return btn;
      };

      choices.forEach((c) => wrap.appendChild(makeBtn(c)));
      wrap.appendChild(makeBtn(getNeitherLabel()));

      parts.bubble.appendChild(wrap);
      chatEl.scrollTop = chatEl.scrollHeight;
    }

    // 2) 「提案します」だけで止まるケースの自動追送信（1回だけ）
    if (shouldAutoContinue(rawText)) {
      autoContinueOnce();
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
    lucyVoiceAskBtn.textContent = isActive ? getTerm("voiceBtnStop", "音声停止") : getTerm("voiceBtnIdle", "Lucyに質問（音声）");
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) throw new Error(`HTTP ${res.status}\n${raw}`);
    if (!parsed.ok) throw new Error(`JSON parse failed\n${raw}`);
    return parsed.value;
  }

  async function transcribeVoiceBlob(blob) {
    const formData = new FormData();
    formData.append("audio", blob, "voice.webm");

    const lang = getCurrentLang();
    formData.append("lang", lang);

    const res = await fetch(WORKER_VOICE_URL, { method: "POST", body: formData });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) throw new Error(`VOICE HTTP ${res.status}\n${raw}`);

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

  function startSpeechRecognition() {
    const Ctor = getSpeechRecognitionCtor();
    if (!Ctor) throw new Error("SpeechRecognition not available");

    stopSpeechRecognition();

    speechRec = new Ctor();
    speechRec.lang = getCurrentLang();
    speechRec.interimResults = false;
    speechRec.continuous = false;

    speechIsRunning = true;
    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus(getTerm("statusRecording", "音声認識中です。話し終えたら自動で送信します。"));

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
      const msg = ev && ev.error ? String(ev.error) : "unknown";
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
    try {
      speechRec.onresult = null;
      speechRec.onerror = null;
      speechRec.onend = null;
    } catch (_) {}
    try {
      speechRec.stop();
    } catch (_) {}
    speechRec = null;
    speechIsRunning = false;
    setLucyVoiceBtnLabel(false);
  }

  async function startServerVoiceRecording() {
    if (voiceIsRecording) return;
    voiceIsRecording = true;
    voiceChunks = [];

    ensurePanelOpenSoftly();
    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus(getTerm("statusRecording", "録音中です。もう一度押すと停止します。"));

    try {
      voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setLucyVoiceStatus("マイクへのアクセスが拒否されました。");
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
      return;
    }

    try {
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
      const actualMimeType = voiceMediaRecorder.mimeType || "audio/webm";
      const blob = new Blob(voiceChunks, { type: actualMimeType });
      voiceChunks = [];
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);

      if (!blob || blob.size === 0) {
        setLucyVoiceStatus("音声データが取得できませんでした。");
        return;
      }

      setLucyVoiceStatus(getTerm("statusSending", "音声を送信しています…"));
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

    voiceMediaRecorder.onerror = () => {
      setLucyVoiceStatus("録音中にエラーが発生しました。");
      try {
        stopVoiceTracks();
      } catch (_) {}
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
    };

    try {
      voiceMediaRecorder.start();
    } catch (e) {
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
      if (voiceMediaRecorder && voiceMediaRecorder.state !== "inactive") voiceMediaRecorder.stop();
    } catch (e) {
      setLucyVoiceStatus("録音停止に失敗しました。");
      stopVoiceTracks();
      voiceIsRecording = false;
      setLucyVoiceBtnLabel(false);
    }
  }

  function isVoiceActive() {
    return !!voiceIsRecording || !!speechIsRunning;
  }

  async function startVoiceFlow() {
    if (isVoiceActive()) return;
    const hasSpeech = !!getSpeechRecognitionCtor();

    if (VOICE_MODE === "speech") return startSpeechRecognition();
    if (VOICE_MODE === "server") return startServerVoiceRecording();

    if (hasSpeech) {
      try {
        return startSpeechRecognition();
      } catch (e) {}
    }
    return startServerVoiceRecording();
  }

  function stopVoiceFlow() {
    if (speechIsRunning) {
      setLucyVoiceStatus("音声認識を停止しました。");
      stopSpeechRecognition();
      return;
    }
    if (voiceIsRecording) stopServerVoiceRecording();
  }

  if (lucyVoiceAskBtn) {
    setLucyVoiceBtnLabel(false);
    lucyVoiceAskBtn.addEventListener("click", async () => {
      if (lucyVoiceAskBtn.disabled) return;
      try {
        if (!isVoiceActive()) await startVoiceFlow();
        else stopVoiceFlow();
      } catch (e) {
        setLucyVoiceStatus("音声機能の起動に失敗しました。");
        appendError("音声の処理に失敗しました", e.message);
        try {
          stopVoiceFlow();
        } catch (_) {}
        setLucyVoiceBtnLabel(false);
      }
    });
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
})();
