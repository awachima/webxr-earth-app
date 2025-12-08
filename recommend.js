// recommend.js
// ツアー提案カード内の簡易チャット UI（フロントのみの擬似AI版）
//
// 後で Cloudflare Workers + Gemini に差し替えやすいように、
// appendMessage や handleSend の構造は分かりやすく分離してあります。

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("recommendInput");
  const sendBtn = document.getElementById("recommendSend");
  const chatBox = document.getElementById("recommendChat");

  if (!input || !sendBtn || !chatBox) {
    return; // 要素が見つからない場合は何もしない
  }

  // --- チャット履歴（将来AIにまとめて渡すことも想定して一応保持） ---
  const history = []; // { role: 'user' | 'assistant', text: string }

  // --- 初期メッセージ ---
  if (!chatBox.dataset.initialized) {
    chatBox.textContent =
      "ここに、あなたとアシスタントのやりとりが表示されます。（現在はテスト用の擬似AIが応答します）";
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

    // 役割ごとに少しスタイルを変える
    const label = document.createElement("span");
    label.style.fontWeight = "600";
    label.style.marginRight = "4px";
    label.textContent = role === "user" ? "あなた：" : "アシスタント：";

    const body = document.createElement("span");
    body.textContent = text;

    line.appendChild(label);
    line.appendChild(body);

    // アシスタント側だけ少しインデント
    if (role === "assistant") {
      line.style.paddingLeft = "8px";
    }

    chatBox.appendChild(line);
    chatBox.scrollTop = chatBox.scrollHeight;

    history.push({ role, text });
  }

  // --- 擬似AIのロジック（キーワードで軽く分岐） ---
  function getPseudoReply(userText) {
    const text = userText.toLowerCase();

    // 「ここだったのか」系（マスターのイメージしていたやりとり）
    if (
      text.includes("ここだったのか") ||
      text.includes("舞台") ||
      text.includes("モデル")
    ) {
      return (
        "「ここだったのか！」系なら、例えばベルギーのアントワープがあります。" +
        "『フランダースの犬』の舞台として知られている場所ですね。" +
        "今後は、こういった“作品の舞台”ジャンルだけを地球儀に残すような絞り込みもできる予定です。"
      );
    }

    // 有名どころ・定番
    if (text.includes("有名") || text.includes("定番") || text.includes("メジャー")) {
      return (
        "定番の有名どころでしたら、エッフェル塔やナイアガラの滝、" +
        "グランドキャニオンのような世界的観光地が候補になります。" +
        "将来的には、スプレッドシートから「定番」ジャンルを抽出して、自動で候補を並べる予定です。"
      );
    }

    // 癒し・リラックス
    if (
      text.includes("癒し") ||
      text.includes("いやし") ||
      text.includes("relax") ||
      text.includes("リラックス")
    ) {
      return (
        "癒し系でしたら、南国ビーチや静かな森林、" +
        "夕焼けがきれいなスポットなどが良さそうです。" +
        "今後は「癒し」ジャンルを付けたツアーだけを地球儀にハイライトする機能を追加する予定です。"
      );
    }

    // 動物系
    if (text.includes("動物") || text.includes("どうぶつ") || text.includes("animal")) {
      return (
        "動物系なら、サファリや水族館、動物園のVRツアーが候補になります。" +
        "ジャンル列に「動物」と付いたスポットだけを地球儀に残す、という絞り込みも後ほど実装していきます。"
      );
    }

    // それ以外（汎用）
    return (
      "ありがとうございます。そのご希望に合いそうなツアーを、" +
      "今後はスプレッドシート上のジャンル情報をもとにAIが候補を絞り込んでくれる予定です。" +
      "まだ試作段階ですが、どんな雰囲気の場所が良いか、自由に書いてみてください。"
    );
  }

  // --- 送信処理 ---
  function handleSend() {
    const text = input.value.trim();
    if (!text) return;

    appendMessage("user", text);
    input.value = "";

    // 本物のAIに差し替えるまでは、擬似AIで応答
    const reply = getPseudoReply(text);
    appendMessage("assistant", reply);
  }

  // ボタンクリック
  sendBtn.addEventListener("click", handleSend);

  // Enter キーで送信（Shift+Enter は将来改行用にしたい場合の余地を残す）
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      handleSend();
    }
  });
});
