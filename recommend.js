// recommend.js
// ツアー提案カード内のチャット UI（Lucy）
// - Lucy Worker (https://lucy-recommend.awachima7.workers.dev/) に問い合わせ
// - Worker からのレスポンス reply / highlightRows / exampleSpots を扱う
// - highlightRows は iframe(earth.html) に postMessage で送信（地球儀連携用）

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatBox = document.getElementById("recommendChat");

  if (!input || !sendBtn || !chatBox) {
    // 要素が見つからない場合は何もしない（別ページ対策）
    return;
  }

  const ASSISTANT_NAME = "Lucy";
  const API_ENDPOINT = "https://lucy-recommend.awachima7.workers.dev/"; // Lucy Worker の URL

  // 会話履歴（Lucy 側にまとめて渡す）
  const history = []; // { role: "user" | "assistant", text: string }[]

  // --- チャット表示用ヘルパー ---

  function appendMessage(role, text) {
    const line = document.createElement("div");
    line.className = "chat-line";

    const label = document.createElement("div");
    label.className = "chat-label";
    label.textContent = role === "user" ? "You" : ASSISTANT_NAME;

    const body = document.createElement("div");
    body.className = "chat-body";

    // 改行を <br> に変換
    body.innerHTML = "";
    for (const part of text.split(/\n/)) {
      const span = document.createElement("span");
      span.textContent = part;
      body.appendChild(span);
      body.appendChild(document.createElement("br"));
    }

    line.appendChild(label);
    line.appendChild(body);
    chatBox.appendChild(line);

    // 常に一番下までスクロール（10行程度のエリア内でスクロールさせる想定）
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function appendThinkingMessage() {
    const line = document.createElement("div");
    line.className = "chat-line thinking-line";

    const label = document.createElement("div");
    label.className = "chat-label";
    label.textContent = ASSISTANT_NAME;

    const body = document.createElement("div");
    body.className = "chat-body";
    body.textContent = "少々お待ちください…おすすめを考えていますね。";

    line.appendChild(label);
    line.appendChild(body);
    chatBox.appendChild(line);
    chatBox.scrollTop = chatBox.scrollHeight;

    return line; // 後で削除・書き換えするために返す
  }

  // --- Earth iframe への連携 ---

  /**
   * Worker から返ってきた highlightRows を earth.html に送信
   * rows: number[] (CSV データ行のインデックス想定)
   */
  function sendHighlightRowsToEarth(rows) {
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
  }

  // --- 送信処理本体 ---

  async function handleSend() {
    const text = (input.value || "").trim();
    if (!text) return;

    // 入力欄を先にクリア
    input.value = "";

    // 自分の発言を表示＆履歴に追加
    appendMessage("user", text);
    history.push({ role: "user", text });

    // 「考え中」メッセージを表示
    const thinkingLine = appendThinkingMessage();

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          history: history,
        }),
      });

      if (!res.ok) {
        console.error("Lucy Worker error:", res.status);
        throw new Error("Lucy Worker HTTP error: " + res.status);
      }

      const data = await res.json().catch(() => ({}));

      const reply =
        (data && typeof data.reply === "string" && data.reply.trim()) ||
        "うまく候補をまとめられなかったようです。少し時間をおいて、もう一度お試しいただけますか？";

      // 「考え中」メッセージを消す
      if (thinkingLine && thinkingLine.parentNode) {
        thinkingLine.parentNode.removeChild(thinkingLine);
      }

      // Lucy の返答を表示
      appendMessage("assistant", reply);
      history.push({ role: "assistant", text: reply });

      // ▼ 地球儀連携：highlightRows を earth.html に通知
      if (Array.isArray(data.highlightRows) && data.highlightRows.length > 0) {
        sendHighlightRowsToEarth(data.highlightRows);
      }

      // （お好みで）exampleSpots をログに出しておく
      if (Array.isArray(data.exampleSpots) && data.exampleSpots.length > 0) {
        console.debug("[Lucy] exampleSpots:", data.exampleSpots);
      }
    } catch (err) {
      console.error("Lucy request failed:", err);

      // 「考え中」メッセージを消す
      if (thinkingLine && thinkingLine.parentNode) {
        thinkingLine.parentNode.removeChild(thinkingLine);
      }

      appendMessage(
        "assistant",
        "接続状況が少し不安定なようで、候補をうまく取得できませんでした。" +
          "\nお手数ですが、時間をおいてもう一度お試しいただけますか？"
      );
      history.push({
        role: "assistant",
        text:
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。\nお手数ですが、時間をおいてもう一度お試しいただけますか？",
      });
    }
  }

  // ボタンクリック
  sendBtn.addEventListener("click", handleSend);

  // Enter キーで送信
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      handleSend();
    }
  });
});
