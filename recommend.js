// recommend.js
// ツアー提案カード内の簡易チャット UI（まだAIとは未接続）

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatBox = document.getElementById("recommendChat");

  if (!input || !sendBtn || !chatBox) {
    return; // 要素が見つからない場合は何もしない
  }

  // 初期メッセージ（1回だけ表示）
  if (!chatBox.dataset.initialized) {
    chatBox.textContent = "ここに、あなたとアシスタントのやりとりが表示されます。（AI連携はこれから実装予定です）";
    chatBox.dataset.initialized = "true";
  }

  function appendMessage(role, text) {
    // 初期テキストが残っていたら消す
    if (chatBox.dataset.initialized === "true") {
      chatBox.textContent = "";
      chatBox.dataset.initialized = "done";
    }

    const line = document.createElement("div");
    line.style.marginBottom = "4px";

    const label = document.createElement("span");
    label.style.fontWeight = "600";
    label.style.marginRight = "4px";
    label.textContent = role === "user" ? "あなた：" : "アシスタント：";

    const body = document.createElement("span");
    body.textContent = text;

    line.appendChild(label);
    line.appendChild(body);
    chatBox.appendChild(line);

    // 下端へスクロール
    chatBox.scrollTop = chatBox.scrollHeight;
  }

  function handleSend() {
    const text = input.value.trim();
    if (!text) return;

    appendMessage("user", text);
    input.value = "";

    // ここに将来 AI へのリクエストを追加する予定。
    // 今は「近日実装」の簡単なダミー応答だけ返す。
    appendMessage(
      "assistant",
      "ありがとうございます。そのご希望に合うジャンルやツアーを、今後AIがスプレッドシートの情報から探してくれる予定です。"
    );
  }

  sendBtn.addEventListener("click", handleSend);

  // Enter キーで送信（Shift+Enter は改行として温存したい場合は後で拡張）
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      handleSend();
    }
  });
});
