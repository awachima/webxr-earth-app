// recommend.js
// Lucy チャット（ツアー提案）
// - Enter / 送信ボタンで送信
// - recommendChat が textarea でも div でも表示できるように対応
// - Lucy Worker: https://lucy-recommend.awachima7.workers.dev/
//
// 2026-01: responseMode（offer/bridge/chat）と state を送る

(() => {
  const API_ENDPOINT = "https://lucy-recommend.awachima7.workers.dev/";
  const MAX_HISTORY = 6;

  // state 保存キー
  const LUCY_STATE_KEY = "dd_lucy_state_v1";

  let sending = false;
  const history = []; // { role: "user" | "assistant", text: string }

  function getEls() {
    const input = document.getElementById("recommendInput");
    const sendBtn = document.getElementById("recommendSend");
    const chat = document.getElementById("recommendChat");
    return { input, sendBtn, chat };
  }

  function isTextAreaLike(el) {
    if (!el || !el.tagName) return false;
    const t = el.tagName.toUpperCase();
    return t === "TEXTAREA" || t === "INPUT";
  }

  function pushHistory(role, text) {
    history.push({ role, text });
    while (history.length > MAX_HISTORY) history.shift();
  }

  // ===== Lucy state =====
  function defaultLucyState() {
    return {
      phase: "entry", // "entry" | "narrow" | "context"
      intent: "mid",  // "high" | "mid" | "low" | "idle"
      conditions: {
        mood: null,
        place: null,
        era: null,
        genre: null,
      },
      stats: {
        offTopicStreak: 0,
        bridgeIgnoredStreak: 0,
        lastAssistantMode: null, // "offer" | "bridge" | "chat"
      },
      bridge: {
        lastOffTopicHadGeoHook: false,
        allowedOnce: true,
      },
    };
  }

  function loadLucyState() {
    try {
      const raw = localStorage.getItem(LUCY_STATE_KEY);
      if (!raw) return defaultLucyState();
      const obj = JSON.parse(raw);
      const base = defaultLucyState();
      return {
        ...base,
        ...obj,
        conditions: { ...base.conditions, ...(obj && obj.conditions ? obj.conditions : {}) },
        stats: { ...base.stats, ...(obj && obj.stats ? obj.stats : {}) },
        bridge: { ...base.bridge, ...(obj && obj.bridge ? obj.bridge : {}) },
      };
    } catch (_e) {
      return defaultLucyState();
    }
  }

  function saveLucyState(state) {
    try {
      localStorage.setItem(LUCY_STATE_KEY, JSON.stringify(state));
    } catch (_e) {}
  }

  // ===== intent判定（最小）=====
  function looksTravelIntent(text) {
    const t = (text || "").trim();
    return /おすすめ|探して|行きたい|ツアー|旅行|観光|見たい|候補|提案|どこでもドア|VRツアー|スポット/.test(t);
  }

  function looksKnowledgeOrChitChat(text) {
    const t = (text || "").trim();
    return /知ってる|どんな話|あらすじ|って何|とは|教えて|説明|違い|意味|原因|なんで|いつ|誰|どこ/.test(t);
  }

  // “地理フック”がある雑談なら bridge しやすい
  function looksGeoHook(text) {
    const t = (text || "").trim();
    return /エジプト|インド|中国|日本|東京|京都|バリ|バリ島|アメリカ|フランス|イタリア|中東|ヨーロッパ/.test(t);
  }

  function didUserAcceptBridgeHeuristic(userText) {
    return looksGeoHook(userText) || looksTravelIntent(userText);
  }

  function updateIntent(state, userText, didUserAcceptBridge) {
    if (looksTravelIntent(userText)) {
      state.intent = "high";
      state.stats.offTopicStreak = 0;
      state.stats.bridgeIgnoredStreak = 0;
      state.bridge.allowedOnce = true;
      state.bridge.lastOffTopicHadGeoHook = false;
      return state;
    }

    const offTopicish = looksKnowledgeOrChitChat(userText) && !looksTravelIntent(userText);
    if (offTopicish) state.stats.offTopicStreak += 1;
    else state.stats.offTopicStreak = 0;

    if (state.stats.lastAssistantMode === "bridge") {
      if (didUserAcceptBridge) state.stats.bridgeIgnoredStreak = 0;
      else state.stats.bridgeIgnoredStreak += 1;
    }

    if (state.stats.offTopicStreak >= 2 || state.stats.bridgeIgnoredStreak >= 2) {
      state.intent = "idle";
      state.bridge.allowedOnce = false;
    } else {
      state.intent = offTopicish ? "low" : "mid";
    }

    state.bridge.lastOffTopicHadGeoHook = looksGeoHook(userText);
    return state;
  }

  function decideResponseMode(state) {
    // 完全雑談モード（橋渡しもやめる）
    if (state.intent === "idle") {
      state.stats.lastAssistantMode = "chat";
      return "chat";
    }

    // 雑談っぽい → chat / bridge
    if (state.intent === "low") {
      if (state.bridge.allowedOnce && state.bridge.lastOffTopicHadGeoHook) {
        state.bridge.allowedOnce = false;
        state.stats.lastAssistantMode = "bridge";
        return "bridge";
      }
      state.stats.lastAssistantMode = "chat";
      return "chat";
    }

    // 通常は offer
    state.stats.lastAssistantMode = "offer";
    return "offer";
  }

  // ===== UI =====
  function ensureChatLineContainer(chat) {
    if (!chat) return null;
    if (isTextAreaLike(chat)) return null;

    let box = chat.querySelector(".lucy-chat-lines");
    if (!box) {
      box = document.createElement("div");
      box.className = "lucy-chat-lines";
      box.style.display = "flex";
      box.style.flexDirection = "column";
      box.style.gap = "10px";
      box.style.padding = "8px 0";
      chat.appendChild(box);
    }
    return box;
  }

  function appendToChat(role, text) {
    const { chat } = getEls();
    if (!chat) return;

    const label = role === "user" ? "You" : "Lucy";

    if (isTextAreaLike(chat)) {
      const prefix = chat.value ? "\n\n" : "";
      chat.value += `${prefix}${label}:\n${text}`;
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    const box = ensureChatLineContainer(chat);
    if (!box) return;

    const wrap = document.createElement("div");
    wrap.style.border = "1px solid rgba(0,0,0,0.08)";
    wrap.style.borderRadius = "10px";
    wrap.style.padding = "10px 12px";
    wrap.style.background = role === "user" ? "rgba(0,0,0,0.02)" : "rgba(255,255,255,0.9)";

    const head = document.createElement("div");
    head.style.fontWeight = "700";
    head.style.fontSize = "0.85rem";
    head.style.opacity = "0.85";
    head.textContent = label;

    const body = document.createElement("div");
    body.style.whiteSpace = "pre-wrap";
    body.style.wordBreak = "break-word";
    body.style.fontSize = "0.95rem";
    body.textContent = text;

    wrap.appendChild(head);
    wrap.appendChild(body);
    box.appendChild(wrap);

    chat.scrollTop = chat.scrollHeight;
  }

  function setSendDisabled(disabled) {
    const { sendBtn } = getEls();
    if (!sendBtn) return;
    sendBtn.disabled = !!disabled;
    sendBtn.style.opacity = disabled ? "0.7" : "";
    sendBtn.style.cursor = disabled ? "not-allowed" : "";
  }

  function sendHighlightsToEarth(highlightRows, exampleSpots) {
    try {
      const iframe = document.getElementById("webxr-iframe");
      if (!iframe || !iframe.contentWindow) return;

      iframe.contentWindow.postMessage(
        {
          type: "dd-lucy-highlight",
          highlightRows: Array.isArray(highlightRows) ? highlightRows : [],
          exampleSpots: Array.isArray(exampleSpots) ? exampleSpots : [],
        },
        "*"
      );
    } catch (e) {
      console.debug("[Lucy] postMessage failed:", e);
    }
  }

  async function handleSend() {
    const { input } = getEls();
    if (!input) return;

    const msg = (input.value || "").trim();
    if (!msg) return;

    if (sending) return;
    sending = true;
    setSendDisabled(true);

    // state（送信前に判定）
    const lucyState = loadLucyState();

    const acceptBridge =
      lucyState.stats.lastAssistantMode === "bridge"
        ? didUserAcceptBridgeHeuristic(msg)
        : false;

    updateIntent(lucyState, msg, acceptBridge);
    const responseMode = decideResponseMode(lucyState);

    // UI更新
    input.value = "";
    appendToChat("user", msg);
    pushHistory("user", msg);

    const stateForWorker = {
      phase: lucyState.phase,
      intent: lucyState.intent,
      conditions: lucyState.conditions,
    };

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          history: history.slice(-MAX_HISTORY),
          responseMode,
          state: stateForWorker,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        appendToChat(
          "assistant",
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。\nお手数ですが、時間をおいてもう一度お試しいただけますか？"
        );
        pushHistory(
          "assistant",
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。"
        );
        saveLucyState(lucyState);
        return;
      }

      const reply = (data.reply && String(data.reply).trim()) ? String(data.reply).trim() : "";
      if (reply) {
        appendToChat("assistant", reply);
        pushHistory("assistant", reply);
      } else {
        const fallback =
          "うまく候補をまとめられなかったようです。\n行ってみたい国や、雰囲気（にぎやか・静か・自然多めなど）を、もう少し教えていただけますか？";
        appendToChat("assistant", fallback);
        pushHistory("assistant", fallback);
      }

      sendHighlightsToEarth(data.highlightRows, data.exampleSpots);
      saveLucyState(lucyState);
    } catch (e) {
      console.error("[Lucy] fetch error:", e);
      appendToChat(
        "assistant",
        "送信に失敗したようです。Network / Console をご確認ください。"
      );
      pushHistory("assistant", "送信に失敗したようです。");
      saveLucyState(lucyState);
    } finally {
      sending = false;
      setSendDisabled(false);
    }
  }

  function bindOnce() {
    if (window.__lucyRecommendBound) return;
    window.__lucyRecommendBound = true;

    document.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("#recommendSend") : null;
      if (!btn) return;
      ev.preventDefault();
      handleSend();
    });

    document.addEventListener("keydown", (ev) => {
      const t = ev.target;
      if (!t || t.id !== "recommendInput") return;

      if (ev.key === "Enter") {
        ev.preventDefault();
        handleSend();
      }
    });

    console.log("[Lucy] recommend.js bound (delegation).");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindOnce);
  } else {
    bindOnce();
  }
})();
