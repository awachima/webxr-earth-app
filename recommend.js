(() => {
  // =========================================================
  // 1) 設定
  // =========================================================
  const WORKER_CHAT_URL = "https://lucy-recommend.awachima7.workers.dev/";
  const WORKER_VOICE_URL = "https://do-stt.awachima7.workers.dev/";

  // i18n（存在すれば使う）
  const getTerm = (key, def) => {
    try {
      const lang = getCurrentLang();
      const dict = window.i18n && window.i18n.recommend;
      if (dict && dict[lang] && dict[lang][key]) return dict[lang][key];
      if (dict && dict.ja && dict.ja[key]) return dict.ja[key];
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

  function getCurrentLang() {
    try {
      const sel = document.getElementById("languageSelect");
      if (sel && sel.value) return String(sel.value);
    } catch (_) {}
    return "ja";
  }

  // =========================================================
  // 5) UI描画（チャットバブル）
  // =========================================================
  function appendBubble(role, name, htmlOrText, isHtml) {
    const row = document.createElement("div");
    row.className = `chat-row ${role === "assistant" ? "assistant-row" : "user-row"}`;

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${role === "assistant" ? "assistant-bubble" : "user-bubble"}`;

    const header = document.createElement("div");
    header.className = "chat-header";
    header.textContent = name;

    const body = document.createElement("div");
    body.className = "chat-body";
    if (isHtml) {
      body.innerHTML = htmlOrText;
    } else {
      body.textContent = htmlOrText;
    }

    bubble.appendChild(header);
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

      // すべての候補をボタン化（絞り込みの候補が多い場合も対応）
      choices.forEach((c) => {
        wrap.appendChild(makeBtn(c));
      });

      // ★追加: 「どっちも違う」ボタン
      // i18nがあれば window.i18n.recommend.choiceNeither を優先
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

  async function transcribeVoiceBlob(blob) {
    const formData = new FormData();
    formData.append("audio", blob, "voice.webm");

    const lang = getCurrentLang();
    formData.append("lang", lang);

    const res = await fetch(WORKER_VOICE_URL, {
      method: "POST",
      body: formData,
    });

    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) {
      throw new Error(`VOICE HTTP ${res.status}\n${raw}`);
    }

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
        const res =
          ev && ev.results && ev.results[0] && ev.results[0][0] ? ev.results[0][0].transcript : "";
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

    speechRec.start();
  }

  function stopSpeechRecognition() {
    if (speechRec) {
      try {
        speechRec.onresult = null;
        speechRec.onerror = null;
        speechRec.onend = null;
        speechRec.stop();
      } catch (_) {}
    }
    speechRec = null;
    speechIsRunning = false;
    setLucyVoiceBtnLabel(false);
  }

  // 録音（MediaRecorder）
  async function startVoiceRecording() {
    if (voiceIsRecording) return;

    stopVoiceRecording();

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    voiceMediaStream = stream;

    const recorder = new MediaRecorder(stream);
    voiceMediaRecorder = recorder;

    voiceChunks = [];
    voiceIsRecording = true;

    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus(getTerm("statusRecording2", "録音中です。もう一度押すと送信します。"));

    recorder.ondataavailable = (e) => {
      if (e && e.data && e.data.size > 0) voiceChunks.push(e.data);
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(voiceChunks, { type: "audio/webm" });
        voiceChunks = [];
        voiceIsRecording = false;

        setLucyVoiceStatus(getTerm("statusTranscribing", "文字起こし中…"));

        const text = await transcribeVoiceBlob(blob);
        setLucyVoiceStatus(`認識：${normalizeUserText(text)}`);

        setSending(true);
        await sendRecognizedTextToLucy(text);
        setLucyVoiceStatus("完了しました。");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus("音声の送信に失敗しました。");
        appendError("音声の処理に失敗しました", e.message);
      } finally {
        setSending(false);
        stopVoiceTracks();
        setLucyVoiceBtnLabel(false);
      }
    };

    recorder.start();
  }

  function stopVoiceRecording() {
    if (!voiceIsRecording) {
      stopVoiceTracks();
      return;
    }
    try {
      if (voiceMediaRecorder && voiceMediaRecorder.state !== "inactive") {
        voiceMediaRecorder.stop();
      }
    } catch (_) {}
  }

  // =========================================================
  // 7) イベント
  // =========================================================
  sendBtn.addEventListener("click", onSend);

  inputEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  });

  if (lucyVoiceAskBtn) {
    lucyVoiceAskBtn.addEventListener("click", async () => {
      try {
        // 送信中は無視
        if (sendBtn.disabled) return;

        // SpeechRecognition が使える環境ならそちら優先
        const Ctor = getSpeechRecognitionCtor();
        if (Ctor) {
          if (speechIsRunning) {
            stopSpeechRecognition();
            setLucyVoiceStatus(getTerm("statusStopped", "停止しました。"));
            return;
          }
          startSpeechRecognition();
          return;
        }

        // 使えない場合は録音方式
        if (voiceIsRecording) {
          stopVoiceRecording();
        } else {
          await startVoiceRecording();
        }
      } catch (e) {
        console.error(e);
        appendError("音声の開始に失敗しました", e.message);
        setLucyVoiceBtnLabel(false);
      }
    });
  }

  // 初期表示（必要なら）
  // appendLucy(getTerm("hello", "いらっしゃいませ。ツアーをお探しですか？"));
})();
