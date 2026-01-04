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

  // 既にバインド済みなら二重登録しない
  if (sendBtn.dataset && sendBtn.dataset.lucyBound === "1") {
    return;
  }

  const ASSISTANT_NAME = "Lucy";
  const WORKER_URL = "https://lucy-recommend.awachima7.workers.dev/";

  // 直近の会話履歴（Worker に渡す用）
  let history = [];

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
    body.textContent = text;

    // 最低限の見た目（CSS が無い環境でも崩れないように）
    line.style.margin = "6px 0";
    label.style.fontWeight = "700";
    label.style.fontSize = "0.85rem";
    label.style.opacity = "0.85";
    body.style.whiteSpace = "pre-wrap";
    body.style.fontSize = "0.92rem";

    line.appendChild(label);
    line.appendChild(body);
    chatBox.appendChild(line);

    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function trimHistory() {
    if (history.length > 6) {
      history = history.slice(history.length - 6);
    }
  }

  // --- Earth へ highlightRows を送る ---
  function sendHighlightsToEarth(highlightRows, exampleSpots) {
    try {
      const iframe = document.getElementById("webxr-iframe");
      if (!iframe || !iframe.contentWindow) {
        console.debug("[Lucy] iframe #webxr-iframe not found, cannot send highlightRows.");
        return;
      }
      const payload = {
        type: "dd-lucy-highlight",
        highlightRows: Array.isArray(highlightRows) ? highlightRows : [],
        exampleSpots: Array.isArray(exampleSpots) ? exampleSpots : [],
      };
      console.debug("[Lucy] postMessage to Earth:", payload);
      iframe.contentWindow.postMessage(payload, "*");
    } catch (e) {
      console.warn("[Lucy] sendHighlightsToEarth error:", e);
    }
  }

  async function handleSend() {
    const message = (input.value || "").trim();
    if (!message) return;

    // UI 更新
    input.value = "";
    appendMessage("user", message);

    // 送信中はボタン無効化
    const prevDisabled = sendBtn.disabled;
    sendBtn.disabled = true;

    try {
      const res = await fetch(WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        appendMessage(
          "assistant",
          "接続状況が少し不安定なようで、候補をうまく取得できませんでした。\nお手数ですが、時間をおいてもう一度お試しいただけますか？"
        );
        return;
      }

      const reply = (data.reply && String(data.reply).trim()) ? String(data.reply).trim() : "(no reply)";
      appendMessage("assistant", reply);

      // 履歴更新（直近だけ）
      history.push({ role: "user", text: message });
      history.push({ role: "assistant", text: reply });
      trimHistory();

      // Earth へ連携（失敗してもチャットは続行）
      sendHighlightsToEarth(data.highlightRows, data.exampleSpots);
    } catch (e) {
      console.error("[Lucy] send error:", e);
      appendMessage(
        "assistant",
        "送信に失敗したようです。Network / Console をご確認ください。"
      );
    } finally {
      sendBtn.disabled = prevDisabled;
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

  // バインド済みマーク（main.js 側のフェイルセーフと競合しないため）
  if (sendBtn.dataset) sendBtn.dataset.lucyBound = "1";
  console.debug("[Lucy] listeners attached (recommend.js)");
});
