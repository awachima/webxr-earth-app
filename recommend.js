// recommend.js
// Lucy チャット（ツアー提案）
// - Enter / 送信ボタンで送信
// - recommendChat が textarea でも div でも表示できるように対応
// - Lucy Worker: https://lucy-recommend.awachima7.workers.dev/

(() => {
  // エンドポイントは window.LUCY_API_ENDPOINT で上書き可能（デバッグ用）
  const API_ENDPOINT_BASE = (window.LUCY_API_ENDPOINT && String(window.LUCY_API_ENDPOINT).trim())
    ? String(window.LUCY_API_ENDPOINT).trim()
    : "https://lucy-recommend.awachima7.workers.dev/";

  function apiEndpoint() {
    // POSTでも念のためキャッシュ回避（環境切替の取り違えを検出しやすくする）
    const sep = API_ENDPOINT_BASE.includes("?") ? "&" : "?";
    return API_ENDPOINT_BASE + sep + "v=" + Date.now();
  }

  const MAX_HISTORY = 6;

  let sending = false;
  const history = []; // { role: "user" | "assistant", text: string }

  function getEls() {
    const input = document.getElementById("recommendInput");
    const sendBtn = document.getElementById("recommendSend");
    const chat = document.getElementById("recommendChat");
    return { input, sendBtn, chat };
  }

  function isTextAreaLike(el) {
    if (!el) return false;
    const tag = (el.tagName || "").toLowerCase();
    return tag === "textarea" || tag === "input";
  }

  function setSendDisabled(disabled) {
    const { input, sendBtn } = getEls();
    if (input) input.disabled = !!disabled;
    if (sendBtn) sendBtn.disabled = !!disabled;
  }

  function pushHistory(role, text) {
    history.push({ role, text: String(text || "") });
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }
  }

  function ensureChatLineBox() {
    const { chat } = getEls();
    if (!chat) return null;

    // textarea / input の場合は、従来通り value に追記する
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

    const t = String(text || "");

    // textarea / input の場合
    if (isTextAreaLike(chat)) {
      const prefix = role === "user" ? "You" : "Lucy";
      const cur = chat.value || "";
      chat.value = (cur ? cur + "\n\n" : "") + `${prefix}\n${t}`;
      // 最下部へ
      chat.scrollTop = chat.scrollHeight;
      return;
    }

    // div の場合
    const box = ensureChatLineBox();
    if (!box) return;

    const bubble = document.createElement("div");
    bubble.className = `lucy-chat-bubble ${role}`;
    bubble.style.maxWidth = "95%";
    bubble.style.whiteSpace = "pre-wrap";
    bubble.style.wordBreak = "break-word";
    bubble.style.padding = "10px 12px";
    bubble.style.borderRadius = "12px";
    bubble.style.lineHeight = "1.45";

    if (role === "user") {
      bubble.style.alignSelf = "flex-end";
      bubble.style.background = "rgba(50,112,166,0.12)";
    } else {
      bubble.style.alignSelf = "flex-start";
      bubble.style.background = "rgba(255,255,255,0.08)";
    }

    const name = document.createElement("div");
    name.style.fontSize = "12px";
    name.style.opacity = "0.75";
    name.style.marginBottom = "4px";
    name.textContent = role === "user" ? "You" : "Lucy";

    const body = document.createElement("div");
    body.textContent = t;

    bubble.appendChild(name);
    bubble.appendChild(body);
    box.appendChild(bubble);

    // 最下部へ
    try {
      box.scrollTop = box.scrollHeight;
      chat.scrollTop = chat.scrollHeight;
    } catch (_e) {}
  }

  function sendHighlightsToEarth(highlightRows, exampleSpots) {
    // earth iframe があれば postMessage する（無ければ何もしない）
    try {
      const iframe = document.getElementById("earthFrame") || document.querySelector("iframe");
      if (!iframe || !iframe.contentWindow) return;

      iframe.contentWindow.postMessage(
        {
          type: "lucy-highlight-rows",
          highlightRows: Array.isArray(highlightRows) ? highlightRows : [],
          exampleSpots: Array.isArray(exampleSpots) ? exampleSpots : [],
        },
        "*"
      );
    } catch (e) {
      console.warn("[Lucy] sendHighlightsToEarth failed:", e);
    }
  }

  async function handleSend() {
    const { input } = getEls();
    if (!input) return;

    const msg = (input.value || "").trim();
    if (!msg) return;

    // 多重送信防止
    if (sending) return;
    sending = true;
    setSendDisabled(true);

    // 先に UI 更新
    input.value = "";
    appendToChat("user", msg);
    pushHistory("user", msg);

    try {
      const res = await fetch(apiEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          message: msg,
          history: history.slice(-MAX_HISTORY),
        }),
      });

      // JSON が取れないケースにも耐える
      const data = await res.json().catch(() => null);

      // Worker 側のデプロイ取り違えを見分けるための情報（あれば）
      if (data && data.buildId) {
        console.log("[Lucy] buildId:", data.buildId);
      }

      if (!res.ok || !data) {
        appendToChat(
          "assistant",
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。\nお手数ですが、時間をおいてもう一度お試しいただけますか？"
        );
        pushHistory(
          "assistant",
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。"
        );
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

      // Earth 連携（あれば）
      sendHighlightsToEarth(data.highlightRows, data.exampleSpots);
    } catch (e) {
      console.error("[Lucy] fetch error:", e);
      appendToChat(
        "assistant",
        "送信に失敗したようです。Network / Console をご確認ください。"
      );
      pushHistory("assistant", "送信に失敗したようです。");
    } finally {
      sending = false;
      setSendDisabled(false);
    }
  }

  function bindOnce() {
    if (window.__lucyRecommendBound) return;
    window.__lucyRecommendBound = true;

    const { input, sendBtn } = getEls();

    if (sendBtn) {
      sendBtn.addEventListener("click", (e) => {
        e.preventDefault();
        handleSend();
      });
    }

    if (input) {
      input.addEventListener("keydown", (e) => {
        // Enter 送信（Shift+Enter は改行）
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleSend();
        }
      });
    }

    // 初期表示（任意）
    // appendToChat("assistant", "いらっしゃいませ。どんなツアーをお探しですか？");
  }

  // DOM の差し替えに強くする
  function onReady(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn);
    } else {
      fn();
    }
  }

  onReady(() => {
    bindOnce();

    // もし後から要素が差し替わる構成なら、一定間隔で再バインドしても良いが、
    // まずは bindOnce のみで十分。必要になったら追加する。
  });
})();
