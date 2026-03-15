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
 * - 「どっちも違う」ボタンを追加（recommend.choiceNeither）
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


const IS_ANDROID = (() => {
  try { return /Android/i.test(navigator.userAgent || ""); } catch (_) { return false; }
})();

  

// ★ Quest向け：音声優先UI（フォーカスが入ると仮想キーボードが出るため）
const IS_QUEST = (() => {
  try { return /Quest|Oculus/i.test(navigator.userAgent || ""); } catch (_) { return false; }
})();

// Questでも手入力は許可する。
// 音声開始時にだけ blur して、不要なキーボード表示を抑える。
function questSafeBlurInput(inputEl) {
  if (!inputEl) return;
  if (!IS_QUEST) return;
  try {
    if (document.activeElement === inputEl) inputEl.blur();
  } catch (_) {}
}

function questSafeFocusInput(inputEl) {
  if (!inputEl) return;
  try {
    if (IS_QUEST) {
      inputEl.readOnly = false;
      inputEl.disabled = false;
      inputEl.removeAttribute("readonly");
      inputEl.removeAttribute("disabled");
      inputEl.setAttribute("inputmode", "text");
      inputEl.focus();
      try { inputEl.click(); } catch (_) {}
      const len = String(inputEl.value || "").length;
      if (typeof inputEl.setSelectionRange === "function") {
        inputEl.setSelectionRange(len, len);
      }
      return;
    }
    inputEl.focus();
  } catch (_) {}
}

function focusVoiceControl() {
  try {
    questSafeBlurInput(inputEl);
    if (lucyVoiceAskBtn) {
      if (!lucyVoiceAskBtn.hasAttribute("tabindex")) lucyVoiceAskBtn.tabIndex = 0;
      lucyVoiceAskBtn.focus({ preventScroll: true });
    }
  } catch (_) {}
}

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

  // ★今回追加：新キー優先＋旧キー後方互換のためのヘルパ
  const getTermCompat = (newKey, oldKey, def) => {
    const vNew = getTerm(newKey, "");
    if (String(vNew || "").trim()) return vNew;
    const vOld = getTerm(oldKey, "");
    if (String(vOld || "").trim()) return vOld;
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


  inputEl.addEventListener("input", () => {
    lucyVoiceAskStatus.textContent = "";
  });


  if (!inputEl || !sendBtn || !chatEl) {
    console.warn("[recommend.js] Required DOM not found.");
    return;
  }


// ★ Questでも手入力を許可するため、入力欄の readOnly 化や自動 blur は行わない。
//    キーボードを閉じたい場面では toggleVoice() 側から questSafeBlurInput() を呼ぶ。
// ★ 追加: Questで仮想キーボードが出ない場合に備え、入力欄タップ時に
//    readOnly/inputmode/disabled を明示的に解除し、その場のユーザー操作内で focus/select する。
if (IS_QUEST) {
  try {
    inputEl.readOnly = false;
    inputEl.disabled = false;
    inputEl.removeAttribute("readonly");
    inputEl.removeAttribute("disabled");
    inputEl.setAttribute("inputmode", "text");
    inputEl.setAttribute("enterkeyhint", "send");
    inputEl.setAttribute("autocomplete", "off");
    inputEl.setAttribute("autocapitalize", "none");
    inputEl.setAttribute("autocorrect", "off");
    inputEl.tabIndex = 0;

    const ensureQuestKeyboard = () => {
      try {
        inputEl.readOnly = false;
        inputEl.disabled = false;
        inputEl.removeAttribute("readonly");
        inputEl.removeAttribute("disabled");
        inputEl.setAttribute("inputmode", "text");
        inputEl.focus();
        const len = String(inputEl.value || "").length;
        if (typeof inputEl.setSelectionRange === "function") {
          inputEl.setSelectionRange(len, len);
        }
        try { inputEl.click(); } catch (_) {}
        setTimeout(ensureQuestInputVisible, 50);
        setTimeout(ensureQuestInputVisible, 220);
        setTimeout(ensureQuestInputVisible, 420);
      } catch (_) {}
    };

    inputEl.addEventListener("pointerup", ensureQuestKeyboard);
    inputEl.addEventListener("touchend", ensureQuestKeyboard, { passive: true });
    inputEl.addEventListener("click", ensureQuestKeyboard);
    inputEl.addEventListener("focus", () => {
      setTimeout(ensureQuestInputVisible, 50);
      setTimeout(ensureQuestInputVisible, 220);
    });
    inputEl.addEventListener("blur", () => {
      setTimeout(() => {
        if (document.activeElement !== inputEl) resetQuestInputVisibility();
      }, 120);
    });

    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", () => {
        if (document.activeElement === inputEl) ensureQuestInputVisible();
      });
      window.visualViewport.addEventListener("scroll", () => {
        if (document.activeElement === inputEl) ensureQuestInputVisible();
      });
    }
  } catch (_) {}
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

// ★ Android向け：WAV(PCM)で送るためのWebAudio録音
let wavAudioCtx = null;
let wavSourceNode = null;
let wavProcessorNode = null;
let wavPcmChunks = [];
let wavSampleRate = 48000;
let wavIsRecording = false;
let wavStartedAt = 0;

  let speechRec = null;
  let speechIsRunning = false;
  let lastSpeechFinal = "";

  // ★ 追加: 直前のLucy返信内容を保持し、音声の曖昧な「ほかには」を文脈で明確化する
  let lastAssistantRawText = "";
  let lastAssistantReplyKind = null; // "single_recommend" | "multi_links" | "choice_prompt" | null
  let lastRecommendKeyword = "";

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

  function getQuestKeyboardInsetPx() {
    try {
      if (!IS_QUEST) return 0;
      const vv = window.visualViewport;
      if (!vv) return 0;
      const inset = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)));
      return inset > 120 ? inset : 0;
    } catch (_) {
      return 0;
    }
  }

  function applyQuestInputVisibilityLayout() {
    if (!IS_QUEST || !recommendSection) return;
    try {
      const basePad = 20;
      const extraPad = questKeyboardInsetPx > 0 ? (questKeyboardInsetPx + 18) : 0;
      recommendSection.style.paddingBottom = `${basePad + extraPad}px`;
      inputEl.style.scrollMarginBottom = `${Math.max(140, questKeyboardInsetPx + 80)}px`;
    } catch (_) {}
  }

  function ensureQuestInputVisible() {
    if (!IS_QUEST || !inputEl) return;
    try {
      questKeyboardInsetPx = getQuestKeyboardInsetPx();
      applyQuestInputVisibilityLayout();
      inputEl.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      const len = String(inputEl.value || "").length;
      if (typeof inputEl.setSelectionRange === "function") {
        inputEl.setSelectionRange(len, len);
      }
    } catch (_) {}
  }

  function resetQuestInputVisibility() {
    if (!IS_QUEST || !recommendSection) return;
    try {
      questKeyboardInsetPx = 0;
      recommendSection.style.paddingBottom = "";
      inputEl.style.scrollMarginBottom = "";
    } catch (_) {}
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



  function detectAssistantReplyKind(rawText) {
    const s = String(rawText || "");
    const choiceInfo = extractChoicesFromLucyReply(s);
    if (choiceInfo && Array.isArray(choiceInfo.choices) && choiceInfo.choices.length >= 2) {
      return "choice_prompt";
    }

    const anchorCount = (s.match(/<a\b[\s\S]*?<\/a>/gi) || []).length;
    const urlCount = (s.match(/https?:\/\/[^\s<>"]+/gi) || []).length;
    const linkCount = Math.max(anchorCount, urlCount);

    if (linkCount >= 2) return "multi_links";
    if (linkCount === 1) return "single_recommend";
    return null;
  }

  function extractRecommendKeywordFromText(text) {
    const s = normalizeUserText(text)
      .replace(/[。．、,，!！?？〜~]+$/g, "")
      .trim();
    if (!s) return "";

    const patterns = [
      /^(.+?)\s*の\s*お(?:す|ス)すめ(?:を教えて)?$/i,
      /^(.+?)\s*お(?:す|ス)すめ(?:を教えて)?$/i,
      /^お(?:す|ス)すめ\s*(.+)$/i,
      /^(.+?)\s*の\s*お(?:す|ス)すめ\s*を\s*もっと(?:教えて)?$/i,
      /^(.+?)\s*の\s*お(?:す|ス)すめ\s*を\s*もう(?:一つ|ひとつ)?(?:教えて)?$/i,
      /^(.+?)\s*の\s*ほかの\s*お(?:す|ス)すめ(?:を教えて)?$/i,
    ];

    for (const re of patterns) {
      const m = s.match(re);
      if (m && m[1]) {
        const kw = normalizeUserText(String(m[1] || "").replace(/^(の|を|は|が)+/g, "").trim());
        if (kw) return kw;
      }
    }
    return "";
  }

  function isVoiceMoreLike(text) {
    const t = String(text || "")
      .trim()
      .replace(/[。．、,，!！?？〜~\s]+/g, "")
      .toLowerCase();
    if (!t) return false;
    return /^(ほか|他|ほかに|他に|ほかには|他には|もっと|次|つぎ|別|別の|べつの)$/.test(t);
  }

  function canonicalizeVoiceTextByContext(text) {
    const normalized = normalizeUserText(text);
    if (!normalized) return { displayText: normalized, workerText: normalized };

    if (isVoiceMoreLike(normalized)) {
      if (lastAssistantReplyKind === "single_recommend") {
        const workerText = lastRecommendKeyword
          ? `${lastRecommendKeyword}のおすすめ`
          : "おすすめ";
        return { displayText: normalized, workerText };
      }
      if (lastAssistantReplyKind === "multi_links") {
        return { displayText: normalized, workerText: "同じ条件で別のツアーを見せて" };
      }
      if (lastAssistantReplyKind === "choice_prompt") {
        return { displayText: normalized, workerText: "別の候補を見せて" };
      }
    }

    return { displayText: normalized, workerText: normalized };
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
    lastAssistantRawText = String(rawText || "");
    lastAssistantReplyKind = detectAssistantReplyKind(lastAssistantRawText);

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

        // ★見た目を壊さないため、従来通り inline style を維持
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

      // ★ここが多言語化対象（新キー choiceNeither を優先）
      // ★「どっちも違う」は通常の絞り込み用。
      // ★ただし「はい／いいえ」だけの確認（二択）では付けない（＝ここで「どっちも違う」を出すとUXが崩れる）。
function isYesNoOnlyChoices(choiceList) {
  try {
    if (!Array.isArray(choiceList) || choiceList.length !== 2) return false;

    const norm = (s) => String(s || "")
      .trim()
      .replace(/[。．，、!！?？\s]+/g, "")
      .toLowerCase();

    const yesRe = /^(はい|うん|ええ|yes|y|ok|okay|sure|是|对|好的|हाँ|हां|כן|بله)$/i;
    const noRe  = /^(いいえ|いや|no|n|nope|否|不|不是|नहीं|いいえです|לא|نه)$/i;

    const a = norm(choiceList[0]);
    const b = norm(choiceList[1]);

    const aYes = yesRe.test(a);
    const aNo  = noRe.test(a);
    const bYes = yesRe.test(b);
    const bNo  = noRe.test(b);

    // 2つが Yes/No の組になっている場合のみ true
    return (aYes && bNo) || (aNo && bYes);
  } catch (_) {
    return false;
  }
}

const isConfirmYesNo = isYesNoOnlyChoices(choices);

// 旧ロジック：S6の「ツアーに戻る/雑談を続ける」では付けない（互換として残す）
const isBackToTourPrompt = !!(nextState && nextState.uiPrompt === "backToTour");

// 結論：Yes/No の確認、または backToTour 系の二択では「どっちも違う」を出さない
const shouldAddNeither = !(isConfirmYesNo || isBackToTourPrompt);

if (shouldAddNeither) {
  wrap.appendChild(makeBtn(getTermCompat("choiceNeither", "choiceNeither", "どっちも違う")));
}

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

  // ★ステータス表示（opacity=0 や :empty の影響を強制解除する）
  function setLucyVoiceStatus(text) {
    if (!lucyVoiceAskStatus) return;

    const t = String(text || "").trim();

    if (!t) {
      lucyVoiceAskStatus.textContent = "";
      lucyVoiceAskStatus.style.setProperty("opacity", "0", "important");
      lucyVoiceAskStatus.style.setProperty("display", "none", "important");
      return;
    }

    lucyVoiceAskStatus.textContent = t;

    lucyVoiceAskStatus.style.setProperty("display", "block", "important");
    lucyVoiceAskStatus.style.setProperty("opacity", "1", "important");
    lucyVoiceAskStatus.style.setProperty("visibility", "visible", "important");

    lucyVoiceAskStatus.style.setProperty("background", "none", "important");
    lucyVoiceAskStatus.style.setProperty("border", "none", "important");
    lucyVoiceAskStatus.style.setProperty("padding", "0", "important");

    // ★見た目指定は従来通り（あなたの希望：#666666 / 13px）
    lucyVoiceAskStatus.style.setProperty("color", "#666666", "important");
    lucyVoiceAskStatus.style.setProperty("font-size", "13px", "important");
    lucyVoiceAskStatus.style.setProperty("margin-top", "6px", "important");
    lucyVoiceAskStatus.style.setProperty("line-height", "1.4", "important");
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
      // ★新キー voiceSendingAfterTalk を優先。旧キー voiceBtnSpeakToSend も後方互換で拾う。
      lucyVoiceAskBtn.textContent = getTermCompat(
        "voiceSendingAfterTalk",
        "voiceBtnSpeakToSend",
        "話し終えたら送信"
      );
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
// ★ Android向け：WAVエンコード
// =========================================================
function mergeFloat32Chunks(chunks) {
  const total = chunks.reduce((s, a) => s + a.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function floatTo16BitPCM(float32) {
  const out = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
}

function encodeWavMono16(pcm16, sampleRate) {
  const numChannels = 1;
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = pcm16.length * bytesPerSample;

  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");

  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);          // PCM
  view.setUint16(20, 1, true);           // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);          // bits

  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);

  // PCM data
  let offset = 44;
  for (let i = 0; i < pcm16.length; i++, offset += 2) {
    view.setInt16(offset, pcm16[i], true);
  }

  return new Blob([buffer], { type: "audio/wav" });
}

function cleanupWavRecorder() {
  try { if (wavProcessorNode) wavProcessorNode.disconnect(); } catch (_) {}
  try { if (wavSourceNode) wavSourceNode.disconnect(); } catch (_) {}
  wavProcessorNode = null;
  wavSourceNode = null;

  try { if (wavAudioCtx) wavAudioCtx.close(); } catch (_) {}
  wavAudioCtx = null;

  wavPcmChunks = [];
  wavIsRecording = false;
  wavStartedAt = 0;
}

  // =========================================================
  // 7) Worker 呼び出し（※送信フォーマットは元のまま維持）
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

  async function sendTextDirect(text, source) {
    const src = String(source || "text");
    const raw = normalizeUserText(text);
    if (!raw) return;

    // 音声でも手入力でも、画面に表示した文字列そのものを Worker に送る
    await submitUserText(raw, src, raw);
  }

  async function submitUserText(displayText, source, workerText) {
    const shownText = normalizeUserText(displayText);
    const sentText = normalizeUserText(workerText || displayText);
    if (!shownText || !sentText) return;

    const recommendKeyword = extractRecommendKeywordFromText(sentText) || extractRecommendKeywordFromText(shownText);
    if (recommendKeyword) lastRecommendKeyword = recommendKeyword;

    ensurePanelOpenSoftly();
    appendUser(shownText);
    inputEl.value = "";

    setSending(true);
    try {
      const data = await callWorker(sentText);
      if (data.nextState) nextState = data.nextState;
      if (data.reply) appendLucy(data.reply);
      if (data.debug) console.log("[Lucy debug]", { source: source || "text", shownText, sentText, lastRecommendKeyword, debug: data.debug });
    } catch (e) {
      appendError("通信に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
      if (String(source || "text") === "voice") {
        focusVoiceControl();
      } else {
        questSafeFocusInput(inputEl);
        if (IS_QUEST) {
          setTimeout(ensureQuestInputVisible, 50);
          setTimeout(ensureQuestInputVisible, 220);
        }
      }
    }
  }

  // =========================================================
  // 8) 送信処理
  // =========================================================
  async function onSend() {
    const text = normalizeUserText(inputEl.value);
    if (!text) return;
    await submitUserText(text, "text", text);
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

      // ★新キー voiceListening を優先（旧キーが無いので互換は不要）
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
          await sendTextDirect(finalText, "voice");
          setLucyVoiceStatus("");
        }
      } catch (e) {
        console.error(e);
        // ★失敗系は新キー voiceNotHeard を優先（旧: voiceFailed）
        setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceFailed", "聞き取れませんでした。もう一度お試しください。"));
      }
    };

    rec.onerror = (e) => {
      console.warn("[SpeechRecognition] error", e);
      setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceFailed", "聞き取れませんでした。もう一度お試しください。"));
    };

    rec.onend = () => {
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);

      if (!lastSpeechFinal) {
        // ★新キー voiceNotHeard を優先（旧: voiceNoResult）
        setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceNoResult", "聞き取れませんでした。もう一度お試しください。"));
      }
    };

    speechRec = rec;
    return true;
  }

  async function startBrowserSpeech() {
    if (!ensureSpeechRec()) {
      setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceUnsupported", "このブラウザでは音声認識が利用できません"));
      return;
    }
    try {
      speechRec.lang = langToSpeechLocale(getCurrentLang());
      speechRec.start();
    } catch (e) {
      console.error(e);
      setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceFailed", "聞き取れませんでした。もう一度お試しください。"));
      speechIsRunning = false;
      setLucyVoiceBtnLabel(false);
    }
  }

  function stopBrowserSpeech() {
    try {
      if (speechRec && speechIsRunning) speechRec.stop();
    } catch (_) {}
  }

  
// ★ Android向け：WebAudioでWAV録音 → /voice
async function startServerVoiceWav() {
  try {
    setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));

    voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // AudioContext はユーザー操作（ボタンクリック）内で生成
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    wavAudioCtx = new AudioCtx();
    wavSampleRate = wavAudioCtx.sampleRate || 48000;

    wavSourceNode = wavAudioCtx.createMediaStreamSource(voiceMediaStream);

    // ScriptProcessor は古いが互換性が高い（Android/Chromeでも動きやすい）
    const bufferSize = 4096;
    wavProcessorNode = wavAudioCtx.createScriptProcessor(bufferSize, 1, 1);

    wavPcmChunks = [];
    wavIsRecording = true;
    wavStartedAt = Date.now();

    wavProcessorNode.onaudioprocess = (ev) => {
      if (!wavIsRecording) return;
      try {
        const input = ev.inputBuffer.getChannelData(0);
        // 参照が使い回されるのでコピー
        wavPcmChunks.push(new Float32Array(input));
      } catch (_) {}
    };

    wavSourceNode.connect(wavProcessorNode);
    // 出力先に繋がないと動かない環境があるため destination へ
    wavProcessorNode.connect(wavAudioCtx.destination);

    setLucyVoiceBtnLabel(true);
    setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
  } catch (e) {
    console.error(e);
    setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voicePermissionDenied", "マイクの許可が必要です"));
    setLucyVoiceBtnLabel(false);
    wavIsRecording = false;
    cleanupWavRecorder();
    stopVoiceTracks();
  }
}

async function stopServerVoiceWav() {
  if (!wavIsRecording) return;

  try {
    setLucyVoiceBtnLabel(false);
    wavIsRecording = false;

    const durationMs = Date.now() - (wavStartedAt || Date.now());

    // ここで録音が短すぎる場合は送らない（空判定の原因になりやすい）
    if (durationMs < 900) {
      setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceTooShort", "もう少し長めに話してみてください。"));
      return;
    }

    setLucyVoiceStatus(getTerm("voiceUploading", "解析中…"));

    const merged = mergeFloat32Chunks(wavPcmChunks);
    const pcm16 = floatTo16BitPCM(merged);
    const wavBlob = encodeWavMono16(pcm16, wavSampleRate);

    const fd = new FormData();
    fd.append("audio", wavBlob, "voice.wav");
    fd.append("lang", getCurrentLang());
    try { fd.append("state", JSON.stringify(nextState || {})); } catch (_) {}
    fd.append("state", JSON.stringify(nextState || {}));

    const res = await fetch(WORKER_VOICE_URL, { method: "POST", body: fd });
    const raw = await res.text();
    const parsed = safeJsonParse(raw);

    if (!res.ok) throw new Error(`HTTP ${res.status}\n${raw}`);
    if (!parsed.ok) throw new Error(`JSON parse failed\n${raw}`);

    const text = normalizeUserText(parsed.value && parsed.value.text);
    if (!text) {
      setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceNoResult", "聞き取れませんでした。もう一度お試しください。"));
      return;
    }

    setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
    await sendTextDirect(text, "voice");
    setLucyVoiceStatus("");
  } catch (e) {
    console.error(e);
    setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceFailed", "聞き取れませんでした。もう一度お試しください。"));
  } finally {
    cleanupWavRecorder();
    stopVoiceTracks();
  }
}

// =========================================================
  // 10) 音声：server（MediaRecorder → /voice）
  // =========================================================
  
async function startServerVoice() {
  // ★ AndroidはGemini側でWebM(Opus)が空になりやすいので、WAV(PCM)方式を優先
  if (IS_ANDROID) {
    await startServerVoiceWav();
    return;
  }

  try {
    setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));

    voiceMediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 可能なら mp4/ogg/webm の順に試す（※MediaRecorderが実際にその形式で出力できる場合のみ）
    const mimeCandidates = [
      "audio/mp4",
      "audio/mp4;codecs=mp4a.40.2",
      "audio/ogg;codecs=opus",
      "audio/webm;codecs=opus",
      "audio/webm",
      "audio/ogg",
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
      setLucyVoiceStatus(getTerm("voiceListening", "聞き取り中…"));
    };

    voiceMediaRecorder.onerror = (e) => {
      console.error(e);
      setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceFailed", "聞き取れませんでした。もう一度お試しください。"));
    };

    const startedAt = Date.now();

    voiceMediaRecorder.onstop = async () => {
      try {
        setLucyVoiceBtnLabel(false);
        voiceIsRecording = false;

        const durationMs = Date.now() - startedAt;
        if (durationMs < 900) {
          setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceTooShort", "もう少し長めに話してみてください。"));
          return;
        }

        setLucyVoiceStatus(getTerm("voiceUploading", "解析中…"));

        const actualType = voiceMediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(voiceChunks, { type: actualType });
        voiceChunks = [];

        // 拡張子をMIMEに合わせる
        const ext =
          /mp4/i.test(actualType) ? "mp4" :
          /ogg/i.test(actualType) ? "ogg" :
          /wav/i.test(actualType) ? "wav" : "webm";

        const fd = new FormData();
        fd.append("audio", blob, `voice.${ext}`);
        fd.append("lang", getCurrentLang());
        try { fd.append("state", JSON.stringify(nextState || {})); } catch (_) {}
        fd.append("state", JSON.stringify(nextState || {}));

        const res = await fetch(WORKER_VOICE_URL, { method: "POST", body: fd });
        const raw = await res.text();
        const parsed = safeJsonParse(raw);

        if (!res.ok) throw new Error(`HTTP ${res.status}\n${raw}`);
        if (!parsed.ok) throw new Error(`JSON parse failed\n${raw}`);

        const text = normalizeUserText(parsed.value && parsed.value.text);
        if (!text) {
          setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceNoResult", "聞き取れませんでした。もう一度お試しください。"));
          return;
        }

        setLucyVoiceStatus(getTerm("voiceRecognized", "認識しました。送信します…"));
        await sendTextDirect(text, "voice");
        setLucyVoiceStatus("");
      } catch (e) {
        console.error(e);
        setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voiceFailed", "聞き取れませんでした。もう一度お試しください。"));
      } finally {
        stopVoiceTracks();
        voiceMediaRecorder = null;
      }
    };

    voiceMediaRecorder.start();
  } catch (e) {
    console.error(e);
    setLucyVoiceStatus(getTermCompat("voiceNotHeard", "voicePermissionDenied", "マイクの許可が必要です"));
    setLucyVoiceBtnLabel(false);
    voiceIsRecording = false;
    stopVoiceTracks();
  }
}

  
function stopServerVoice() {
  // ★ Android (WAV) 側
  if (IS_ANDROID) {
    // WAV録音は MediaRecorder を使わない
    stopServerVoiceWav();
    return;
  }

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

    // ★ Quest: 音声開始前にフォーカスを外してキーボードを出さない
    questSafeBlurInput(inputEl);
    resetQuestInputVisibility();
    if (speechIsRunning) {
      stopBrowserSpeech();
      return;
    }
    if (voiceIsRecording || wavIsRecording) {
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
  // 12) 初期化（挨拶：パネルを開いた時に、その瞬間の言語で1回だけ）
  // =========================================================
  function isPanelOpen() {
    try {
      if (touristInfoBtn && touristInfoBtn.getAttribute("aria-expanded") === "true") return true;
    } catch (_) {}
    try {
      if (recommendSection && !recommendSection.classList.contains("is-collapsed")) return true;
    } catch (_) {}
    return false;
  }

  function isChatEmpty() {
    try {
      if (!chatEl) return true;
      if (chatEl.children && chatEl.children.length > 0) return false;
      return String(chatEl.textContent || "").trim() === "";
    } catch (_) {
      return true;
    }
  }

  async function initLucyGreetingIfNeeded() {
    if (lucyGreetingShown) return;

    if (!isChatEmpty()) {
      lucyGreetingShown = true;
      return;
    }

    setLucyVoiceStatus("");
    setSending(true);
    try {
      const data = await callWorker(null);
      if (data.nextState) nextState = data.nextState;
      if (data.reply) appendLucy(data.reply);
      if (data.debug) console.log("[Lucy debug]", data.debug);
      lucyGreetingShown = true;
    } catch (e) {
      appendError("初期化に失敗しました", e.message);
      console.error(e);
    } finally {
      setSending(false);
    }
  }

  if (touristInfoBtn) {
    touristInfoBtn.addEventListener("click", () => {
      setTimeout(() => {
        if (isPanelOpen()) initLucyGreetingIfNeeded();
      }, 0);
    });
  }

  setTimeout(() => {
    if (isPanelOpen()) initLucyGreetingIfNeeded();
  }, 0);

  // =========================================================
  // 13) イベント登録
  // =========================================================
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
