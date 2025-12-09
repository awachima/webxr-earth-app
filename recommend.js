// recommend.js
// ツアー提案カード内のチャット UI（Lucy）
// - ブラウザから Lucy Worker (https://lucy-recommend.awachima7.workers.dev/) に問い合わせ
// - エラー時は簡易な擬似返信でフォロー
// - 将来的に、Worker から返ってきた「候補行」を earth.html 側に postMessage で渡す

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatBox = document.getElementById("recommendChat");
  const earthIframe = document.getElementById("webxr-iframe"); // 地球儀 iframe（存在しなくてもOK）

  if (!input || !sendBtn || !chatBox) {
    return; // 要素が見つからない場合は何もしない
  }

  // チャット欄をカード内スクロールにする（10行前後を想定）
  chatBox.style.maxHeight = "12em";
  chatBox.style.overflowY = "auto";

  const ASSISTANT_NAME = "Lucy";
  const API_ENDPOINT = "https://lucy-recommend.awachima7.workers.dev/"; // ← Lucy Worker のURL

  // --- チャット履歴（将来、まとめてAIに渡すとき用） ---
  const history = []; // { role: 'user' | 'assistant', text: string }

  // --- 初期メッセージ ---
  if (!chatBox.dataset.initialized) {
    chatBox.textContent =
      "ここに、あなたと Lucy のやりとりが表示されます。現在は試験運用中のため、応答内容は今後改善されていきます。";
    chatBox.dataset.initialized = "true";
  }

  // --- メッセージ表示用ヘルパー ---
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

    if (role === "user") {
      label.textContent = "あなた：";
    } else {
      label.textContent = ASSISTANT_NAME + "：";
      line.style.paddingLeft = "8px"; // Lucy の発言だけ少しインデント
    }

    const body = document.createElement("span");
    body.textContent = text;

    line.appendChild(label);
    line.appendChild(body);
    chatBox.appendChild(line);

    chatBox.scrollTop = chatBox.scrollHeight;

    history.push({ role, text });
  }

  // --- 地球儀 (earth.html) への通知ヘルパー ---
  // Worker から highlightRows / exampleSpots が返ってきたら、
  // それを iframe に postMessage で伝える（earth.html 側は後で実装）
  function sendHighlightToEarth(highlightRows, exampleSpots) {
    if (!earthIframe || !earthIframe.contentWindow) {
      return;
    }
    if (!Array.isArray(highlightRows)) {
      return;
    }

    const payload = {
      type: "lucy-highlight",
      rows: highlightRows,      // シート上の「候補行」を想定（1始まり/0始まりかは earth 側で調整）
      exampleSpots: Array.isArray(exampleSpots) ? exampleSpots : undefined,
    };

    try {
      // 同一オリジン前提なので targetOrigin は "*" で運用
      earthIframe.contentWindow.postMessage(payload, "*");
    } catch (e) {
      console.error("sendHighlightToEarth postMessage error:", e);
    }
  }

  // --- エラー時などの簡易な擬似返信（保険） ---
  function getFallbackReply(userText) {
    const text = userText.toLowerCase();

    if (
      text.includes("ここだったのか") ||
      text.includes("舞台") ||
      text.includes("モデル")
    ) {
      return (
        "通信状態があまり良くないようなので、仮のご案内になりますが…" +
        "「ここだったのか！」という発見がある場所としては、たとえばベルギーのアントワープがあります。" +
        "『フランダースの犬』の舞台として知られている場所ですね。"
      );
    }

    if (text.includes("有名") || text.includes("定番") || text.includes("メジャー")) {
      return (
        "接続が不安定なため仮の回答になりますが、定番どころでしたらエッフェル塔やナイアガラの滝、" +
        "グランドキャニオンのような観光地が候補になりそうです。"
      );
    }

    if (
      text.includes("癒し") ||
      text.includes("いやし") ||
      text.includes("relax") ||
      text.includes("リラックス")
    ) {
      return (
        "今は仮のご案内になってしまいますが、癒しをお求めなら、南国のビーチや静かな森林、" +
        "夕焼けがきれいなスポットなどがおすすめになりそうです。"
      );
    }

    if (text.includes("動物") || text.includes("どうぶつ") || text.includes("animal")) {
      return (
        "一時的にAIと通信できていないようなので、代わりに大まかなご案内をしますね。" +
        "サファリや水族館、動物園のツアーなどが候補として考えられそうです。"
      );
    }

    return (
      "うまくAIと通信できなかったようなので、仮のご案内になりますが…" +
      "ご希望の雰囲気に合いそうなツアーを、今後はスプレッドシート上のジャンル情報から自動で探せるようにしていきます。"
    );
  }

  // --- 送信処理 ---
  async function handleSend() {
    const text = input.value.trim();
    if (!text) return;

    appendMessage("user", text);
    input.value = "";

    // 軽い「考え中」メッセージ（後で削除する）
    const thinkingLine = document.createElement("div");
    thinkingLine.style.marginBottom = "4px";
    thinkingLine.style.paddingLeft = "8px";

    const thinkingLabel = document.createElement("span");
    thinkingLabel.style.fontWeight = "600";
    thinkingLabel.style.marginRight = "4px";
    thinkingLabel.textContent = ASSISTANT_NAME + "：";

    const thinkingBody = document.createElement("span");
    thinkingBody.textContent = "少々お待ちください…おすすめを考えていますね。";

    thinkingLine.appendChild(thinkingLabel);
    thinkingLine.appendChild(thinkingBody);
    chatBox.appendChild(thinkingLine);
    chatBox.scrollTop = chatBox.scrollHeight;

    try {
      const res = await fetch(API_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: text,
          history, // Worker 側で会話履歴を活用するために送っておく
        }),
      });

      if (!res.ok) {
        throw new Error("HTTP " + res.status);
      }

      const data = await res.json();
      const reply =
        (data && typeof data.reply === "string" && data.reply.trim()) ||
        getFallbackReply(text);

      // ここで、Worker 側が今後返す予定の候補行情報を earth.html に渡す
      // （現時点で highlightRows / exampleSpots が未実装でも問題なく動作する）
      const highlightRows = Array.isArray(data.highlightRows)
        ? data.highlightRows
        : null;
      const exampleSpots = Array.isArray(data.exampleSpots)
        ? data.exampleSpots
        : null;

      if (highlightRows && highlightRows.length > 0) {
        sendHighlightToEarth(highlightRows, exampleSpots);
      }

      // 「考え中」行を消してから本回答を追加
      thinkingLine.remove();
      appendMessage("assistant", reply);
    } catch (err) {
      // 通信エラー時：考え中行を消してフォールバック
      console.error("Lucy recommend fetch error:", err);
      thinkingLine.remove();
      const fallback = getFallbackReply(text);
      appendMessage("assistant", fallback);
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
