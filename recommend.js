// recommend.js
// ツアー提案カード内のチャット UI（Lucy）
// - Lucy Worker (https://lucy-recommend.awachima7.workers.dev/) に問い合わせ
// - Worker からのレスポンス reply / highlightRows / exampleSpots を扱う
// - highlightRows は iframe(earth.html) に postMessage で送信（地球儀連携用）

(() => {
  const API_ENDPOINT = "https://lucy-recommend.awachima7.workers.dev/";
  const MAX_HISTORY = 6;

  // 送信中フラグ（多重送信防止）
  let sending = false;

  // 履歴（Worker に渡す用）
  const history = [];

  function getEls() {
    const input = document.getElementById("recommendInput");
    const chatBox = document.getElementById("recommendChat");
    // 送信ボタンは差し替わる可能性があるので毎回取り直す
    const sendBtn = document.getElementById("recommendSend");
    return { input, sendBtn, chatBox };
  }

  function pushHistory(role, text) {
    history.push({ role, text });
    // 末尾 MAX_HISTORY 件だけ保持
    while (history.length > MAX_HISTORY) history.shift();
  }

  function appendMessage(role, text) {
    const { chatBox } = getEls();
    if (!chatBox) return;

    const line = document.createElement("div");
    line.style.margin = "6px 0";
    line.style.whiteSpace = "pre-wrap";
    line.style.wordBreak = "break-word";

    if (role === "user") {
      line.style.fontWeight = "600";
      line.textContent = text;
    } else {
      line.textContent = text;
    }

    chatBox.value += (chatBox.value ? "\n\n" : "") + line.textContent;
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function appendThinkingMessage() {
    const { chatBox } = getEls();
    if (!chatBox) return null;

    const marker = "\n\n（考え中…）";
    chatBox.value += marker;
    chatBox.scrollTop = chatBox.scrollHeight;

    return marker;
  }

  function removeThinkingMessage(marker) {
    const { chatBox } = getEls();
    if (!chatBox || !marker) return;

    if (chatBox.value.endsWith(marker)) {
      chatBox.value = chatBox.value.slice(0, -marker.length);
    } else {
      // 念のため（末尾以外に混ざった場合）
      chatBox.value = chatBox.value.replace(marker, "");
    }
  }

  function sendHighlightRowsToEarth(rows) {
    try {
      if (!Array.isArray(rows) || rows.length === 0) {
        console.debug("[Lucy] highlightRows is empty or invalid. skip.");
        return;
      }

      const iframe = document.getElementById("webxr-iframe");
      if (!iframe || !iframe.contentWindow) {
        console.debug("[Lucy] iframe #webxr-iframe not found, cannot send highlightRows.");
        return;
      }

      const payload = {
        type: "lucy-filter-rows",
        rows: rows,
      };

      console.debug("[Lucy] postMessage to Earth:", payload);
      iframe.contentWindow.postMessage(payload, "*");
    } catch (e) {
      console.error("[Lucy] postMessage error:", e);
    }
  }

  async function handleSend() {
    const { input, sendBtn } = getEls();
    if (!input) return;

    const text = (input.value || "").trim();
    if (!text) return;

    if (sending) return;
    sending = true;

    // ボタンを一時的に無効化（存在する場合）
    if (sendBtn) {
      sendBtn.disabled = true;
      sendBtn.style.opacity = "0.7";
      sendBtn.style.cursor = "not-allowed";
    }

    // 入力欄を先にクリア
    input.value = "";

    // 自分の発言を表示＆履歴に追加
    appendMessage("user", text);
    pushHistory("user", text);

    // 「考え中」メッセージを表示
    const thinkingMarker = appendThinkingMessage();

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: history.slice(-MAX_HISTORY),
        }),
      });

      const data = await res.json().catch(() => null);

      removeThinkingMessage(thinkingMarker);

      if (!res.ok || !data) {
        const msg =
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。\n" +
          "お手数ですが、時間をおいてもう一度お試しいただけますか？";
        appendMessage("assistant", msg);
        pushHistory("assistant", msg);
        return;
      }

      const reply = (data.reply || "").trim();
      if (reply) {
        appendMessage("assistant", reply);
        pushHistory("assistant", reply);
      } else {
        const msg =
          "うまく候補をまとめられなかったようです。\n行ってみたい国や、雰囲気（にぎやか・静か・自然多めなど）を、もう少し教えていただけますか？";
        appendMessage("assistant", msg);
        pushHistory("assistant", msg);
      }

      // 地球儀へハイライト行を送る（あれば）
      if (Array.isArray(data.highlightRows) && data.highlightRows.length) {
        sendHighlightRowsToEarth(data.highlightRows);
      }
    } catch (e) {
      console.error("[Lucy] fetch error:", e);
      removeThinkingMessage(thinkingMarker);

      const msg =
        "接続状況が少し不安定なようで、候補をうまく取得できませんでした。\n" +
        "お手数ですが、時間をおいてもう一度お試しいただけますか？";
      appendMessage("assistant", msg);
      pushHistory("assistant", msg);
    } finally {
      sending = false;

      // ボタン復帰
      const { sendBtn: btn2 } = getEls();
      if (btn2) {
        btn2.disabled = false;
        btn2.style.opacity = "";
        btn2.style.cursor = "";
      }
    }
  }

  // ========= イベント委譲（差し替えに強い） =========
  function bindOnce() {
    if (window.__lucyRecommendBound) return;
    window.__lucyRecommendBound = true;

    // クリック送信（ボタンが差し替わっても拾う）
    document.addEventListener("click", (ev) => {
      const btn = ev.target && ev.target.closest ? ev.target.closest("#recommendSend") : null;
      if (!btn) return;
      ev.preventDefault();
      handleSend();
    });

    // Enter 送信（入力欄が差し替わっても拾う）
    document.addEventListener("keydown", (ev) => {
      const t = ev.target;
      if (!t || t.id !== "recommendInput") return;

      if (ev.key === "Enter") {
        ev.preventDefault();
        handleSend();
      }
    });

    console.log("[Lucy] recommend.js: event handlers bound (delegation).");
  }

  // DOM 準備タイミングに依存しない
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindOnce);
  } else {
    bindOnce();
  }
})();
