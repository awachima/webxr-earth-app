// ========================================================
//  Meetup Lobby - lobby.js  （多言語対応版）
// ========================================================

(() => {
  // ===== ユーティリティ =====
  function $(selector) {
    return document.querySelector(selector);
  }
  function $all(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  // デバッグログ（画面下部の <pre id="debug"> に出す）
  function debugLog(...args) {
    const pre = $("#debug");
    if (!pre) return;
    const text = args
      .map((x) =>
        typeof x === "string" ? x : JSON.stringify(x, null, 2)
      )
      .join(" ");
    pre.textContent += `[${new Date().toISOString()}] ${text}\n`;
  }

  // ===== URL パラメータ =====
  const url = new URL(location.href);
  const roomId = url.searchParams.get("roomId") || "";
  const titleParam = url.searchParams.get("title") || "";
  const startParam = url.searchParams.get("start") || "";
  const limitParam = url.searchParams.get("limit") || "";
  const tourUrlParam = url.searchParams.get("tourUrl") || "";
  const eventTypeParam = url.searchParams.get("eventType") || "";
  const priceParam = url.searchParams.get("price") || "";

  // 言語（index.html から ?lang=xx で渡される）
  const langParam = url.searchParams.get("lang") || "ja";

  // ローカルストレージに覚えているニックネーム
  const LS_NAME_KEY = "dokodemo_lobby_name_v1";

  // ===== DOM 参照 =====
  const lobbyHeaderTitle = $("#lobbyHeaderTitle");
  const backToIndex = $("#backToIndex");
  const setNameBtn = $("#setName");

  const titleEl = $("#title");
  const metaEl = $("#meta");
  const countdownLabel = $("#countdownLabel");
  const countdownEl = $("#count");
  const mainStatusEl = $("#status");
  const enterLink = $("#enter");
  const copyRoomUrlBtnLegacy = $("#copy"); // HTML 側は id="copy"

  const limitPill = $("#limitPill");

  const textChatLabel = $("#textChatLabel");
  const chatLog = $("#chatLog");
  const chatInput = $("#chatInput");
  const chatSendBtn = $("#chatSend");
  const chatStatus = $("#chatStatus");

  const voiceLabel = $("#voiceLabel");
  const voiceNameLabel = $("#voiceNameLabel");
  const voiceToggle = $("#voiceToggle");
  const voiceStatus = $("#voiceStatus");
  const voiceHint = $("#voiceHint");
  const enableSoundBtn = $("#enableSound");

  const voiceAskBtn = $("#voiceAskBtn");
  const voiceAskStatus = $("#voiceAskStatus");

  const noticeSmalls = $all(".notice-small");
  const footerEl = $("#lobbyFooter");

  // ===== 多言語リソースの読み込み =====
  let langData = null;

  function t(path, fallback) {
    if (!langData) return fallback;
    const parts = path.split(".");
    let cur = langData;
    for (const p of parts) {
      if (cur && Object.prototype.hasOwnProperty.call(cur, p)) {
        cur = cur[p];
      } else {
        return fallback;
      }
    }
    if (typeof cur === "string") return cur;
    return fallback;
  }

  function applyLobbyTexts() {
    // ヘッダー
    if (lobbyHeaderTitle)
      lobbyHeaderTitle.textContent = t(
        "lobby.headerTitle",
        "待ち合わせロビー"
      );

    if (backToIndex)
      backToIndex.textContent = t("lobby.back", "← 戻る");

    if (setNameBtn)
      setNameBtn.textContent = t("lobby.nicknameButton", "ニックネーム");

    // カウントダウン
    if (countdownLabel)
      countdownLabel.textContent = t(
        "lobby.countdownLabel",
        "カウントダウン"
      );

    if (mainStatusEl)
      mainStatusEl.textContent = t(
        "lobby.waitStatus",
        "開始までお待ちください。"
      );

    // 「ツアーに行く」ボタン
    const enterBtn = $("#enter");
    if (enterBtn)
      enterBtn.textContent = t("lobby.enterButton", "ツアーに行く");

    // 「この待合室のURLをコピー」ボタン
    const copyRoomUrlBtn = $("#copy");
    if (copyRoomUrlBtn)
      copyRoomUrlBtn.textContent = t(
        "lobby.copyRoomUrl",
        "この待合室のURLをコピー"
      );

    // 下部の注意書き（音声ON/OFF）
    if (noticeSmalls[0])
      noticeSmalls[0].textContent = t(
        "lobby.voiceNotice",
        "🔊 音声はON/OFFで改善することがあります。"
      );

    // 執事への注意書き
    if (noticeSmalls[1])
      noticeSmalls[1].textContent = t(
        "lobby.butlerNotice",
        "🤵 ゆっくり・はっきり話すと認識が安定します。"
      );

    // テキストチャットラベル
    if (textChatLabel)
      textChatLabel.textContent = t(
        "lobby.textChatLabel",
        "テキストチャット"
      );

    // 執事に質問（音声）
    if (voiceAskBtn)
      voiceAskBtn.textContent = t(
        "lobby.voiceAskButton",
        "執事に質問（音声）"
      );

    if (voiceAskStatus)
      voiceAskStatus.textContent = "";

    // 音声 ON/OFF 説明
    if (voiceStatus)
      voiceStatus.textContent = t(
        "lobby.voiceStatusInitial",
        "音声: 未参加"
      );

    if (enableSoundBtn)
      enableSoundBtn.textContent = t(
        "lobby.enableSound",
        "スマホで音を有効化"
      );

    // チャット接続ステータス
    if (chatStatus)
      chatStatus.textContent = t(
        "lobby.chatStatusDisconnected",
        "接続していません"
      );

    // チャット送信ボタン
    if (chatSendBtn)
      chatSendBtn.textContent = t("lobby.chatSend", "送信");

    // フッター
    if (footerEl)
      footerEl.textContent = t(
        "lobby.footer",
        "© DokodemoDoors"
      );
  }

  async function loadLangData(lang) {
    let langFile = "ja.json";
    switch (lang) {
      case "en":
        langFile = "en.json";
        break;
      case "zh":
      case "zh-CN":
        langFile = "zh.json";
        break;
      case "fa":
        langFile = "fa.json";
        break;
      case "hi":
        langFile = "hi.json";
        break;
      case "he":
        langFile = "he.json";
        break;
      default:
        langFile = "ja.json";
        break;
    }

    const url = `./lang/${langFile}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Lang fetch failed: ${res.status}`);
      langData = await res.json();
      debugLog("Loaded lang:", lang, url);
    } catch (e) {
      debugLog("Lang load error:", e.message || e);
      langData = null;
    }

    // 文言を適用
    applyLobbyTexts();
    // ロビー情報と音声UIは、現在の状態に合わせて再描画
    updateInfoDisplay();
    updateVoiceUI();
  }

  // ページ読込時に現在の langParam をロード
  loadLangData(langParam);

  // ===== ロビー状態 =====
  let startTime = null; // ISO 文字列 or null
  let limit = null; // number or null
  let tourUrl = "";
  let eventType = "";
  let price = "";
  let target = tourUrlParam || "";

  let ws = null;
  let isConnected = false;
  let myClientId = null;
  let joinedCount = 0;

  let voiceJoined = false;
  let voiceSendState = "off"; // "off" | "on"
  let mediaStream = null;

  // ===== ニックネーム =====
  function getStoredName() {
    return localStorage.getItem(LS_NAME_KEY) || "";
  }
  function setStoredName(name) {
    localStorage.setItem(LS_NAME_KEY, name);
  }

  function updateVoiceUI() {
    if (!voiceStatus) return;

    if (!voiceJoined) {
      voiceStatus.textContent = t("lobby.voiceNone", "音声: 未参加");
    } else {
      const stateText =
        voiceSendState === "on"
          ? t("lobby.micOn", "ON")
          : t("lobby.micOff", "OFF");
      voiceStatus.textContent = t(
        "lobby.voiceJoined",
        "音声: 参加中（マイク {state}）"
      ).replace("{state}", stateText);
    }
  }

  // ===== ロビー情報の描画 =====
  function updateInfoDisplay() {
    if (limitPill) {
      if (limit && limit > 0) {
        limitPill.style.display = "";
        limitPill.textContent = t(
          "lobby.limitLabel",
          "人数制限あり: {count}名"
        ).replace("{count}", String(limit));
      } else {
        limitPill.style.display = "none";
      }
    }

    if (metaEl) {
      const label = t("lobby.startLabel", "開始時刻：");
      if (startTime) {
        const d = new Date(startTime);
        const y = d.getFullYear();
        const m = ("0" + (d.getMonth() + 1)).slice(-2);
        const day = ("0" + d.getDate()).slice(-2);
        const hh = ("0" + d.getHours()).slice(-2);
        const mm = ("0" + d.getMinutes()).slice(-2);
        metaEl.textContent = `${label}${y}/${m}/${day} ${hh}:${mm}`;
      } else {
        metaEl.textContent = `${label}—`;
      }
    }
  }

  // ===== ロビー情報を API から取得 =====
  async function fetchLobbyInfo() {
    if (!roomId) return;

    try {
      const res = await fetch(`/db-chat/info?roomId=${encodeURIComponent(roomId)}`);
      if (!res.ok) {
        debugLog("info API error:", res.status);
        return;
      }
      const data = await res.json();
      debugLog("info:", data);

      const {
        title,
        start,
        limit: l,
        url: u,
        eventType: et,
        price: p,
      } = data;

      if (titleEl) {
        titleEl.textContent =
          title || t("lobby.noTitle", "（タイトル未設定）");
      }

      startTime = start || null;
      limit = typeof l === "number" ? l : null;
      tourUrl = u || "";
      eventType = et || "";
      price = p || "";

      target = tourUrl || "";

      updateInfoDisplay();
      setupCountdown();

      // 入室ボタンのリンクも更新
      if (enterLink && target) {
        enterLink.href = target;
      }
    } catch (e) {
      debugLog("fetchLobbyInfo error:", e.message || e);
    }
  }

  // ===== カウントダウン =====
  function setupCountdown() {
    if (!countdownEl) return;

    function update() {
      if (!startTime) {
        countdownEl.textContent = "--:--:--";
        if (mainStatusEl)
          mainStatusEl.textContent = t(
            "lobby.waitStatus",
            "開始までお待ちください。"
          );
        return;
      }
      const now = Date.now();
      const startMs = new Date(startTime).getTime();
      const diff = startMs - now;

      if (diff <= 0) {
        countdownEl.textContent = "00:00:00";
        if (mainStatusEl)
          mainStatusEl.textContent = t(
            "lobby.started",
            "ツアーが開始しました。"
          );
        return;
      }

      const totalSec = Math.floor(diff / 1000);
      const h = ("0" + Math.floor(totalSec / 3600)).slice(-2);
      const m = ("0" + Math.floor((totalSec % 3600) / 60)).slice(-2);
      const s = ("0" + (totalSec % 60)).slice(-2);
      countdownEl.textContent = `${h}:${m}:${s}`;
      if (mainStatusEl)
        mainStatusEl.textContent = t(
          "lobby.waitStatus",
          "開始までお待ちください。"
        );
    }

    update();
    setInterval(update, 1000);
  }

  // ===== WebSocket =====
  function connectWebSocket() {
    if (!roomId) {
      debugLog("no roomId, skip WS");
      return;
    }

    const wsUrl = (() => {
      const base = location.origin.replace(/^http/, "ws");
      return `${base}/db-chat/ws?roomId=${encodeURIComponent(
        roomId
      )}&lang=${encodeURIComponent(langParam)}`;
    })();

    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      debugLog("WS open");
      isConnected = true;
      if (chatStatus)
        chatStatus.textContent = t(
          "lobby.chatStatusConnected",
          "接続しました"
        );
    });

    ws.addEventListener("message", (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerEvent(msg);
      } catch (e) {
        debugLog("WS message parse error:", e, event.data);
      }
    });

    ws.addEventListener("close", () => {
      debugLog("WS closed");
      isConnected = false;
      if (chatStatus)
        chatStatus.textContent = t(
          "lobby.chatStatusDisconnected",
          "接続していません"
        );
    });

    ws.addEventListener("error", (e) => {
      debugLog("WS error:", e);
    });
  }

  function appendChatLine(text, type = "system") {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = `chat-line chat-${type}`;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function handleServerEvent(msg) {
    // ここは index.ts の仕様に合わせてある前提
    if (msg.type === "hello") {
      myClientId = msg.clientId || null;
      joinedCount = msg.joinedCount || 0;
      if (chatStatus)
        chatStatus.textContent = t(
          "lobby.chatStatusConnected",
          "接続しました"
        );
      if (msg.roomInfo) {
        const { title, start, limit: l, url: u, eventType: et, price: p } =
          msg.roomInfo;
        if (titleEl) {
          titleEl.textContent =
            title || t("lobby.noTitle", "（タイトル未設定）");
        }
        startTime = start || null;
        limit = typeof l === "number" ? l : null;
        tourUrl = u || "";
        eventType = et || "";
        price = p || "";
        target = tourUrl || "";
        updateInfoDisplay();
        setupCountdown();
        if (enterLink && target) {
          enterLink.href = target;
        }
      }
      if (typeof joinedCount === "number") {
        const joinedLabel = $("#joinedLabel");
        if (joinedLabel) {
          joinedLabel.textContent = t(
            "lobby.joinedLabel",
            "参加人数"
          );
        }
        const joinedValue = $("#joinedValue");
        if (joinedValue) {
          joinedValue.textContent = `${joinedCount} 人`;
        }
      }
      return;
    }

    if (msg.type === "log") {
      if (Array.isArray(msg.entries)) {
        msg.entries.forEach((entry) => {
          appendChatLine(entry.text || "", entry.kind || "system");
        });
      }
      return;
    }

    if (msg.type === "chat") {
      appendChatLine(msg.text || "", "user");
      return;
    }

    if (msg.type === "robo") {
      appendChatLine(msg.text || "", "robo");
      return;
    }

    if (msg.type === "joinedCount") {
      joinedCount = msg.joinedCount || 0;
      const joinedValue = $("#joinedValue");
      if (joinedValue) {
        joinedValue.textContent = `${joinedCount} 人`;
      }
      return;
    }

    if (msg.type === "voice") {
      if (msg.subtype === "ask-status") {
        const text = msg.text || "";
        if (voiceAskStatus) voiceAskStatus.textContent = text;
      }
      return;
    }
  }

  function sendToServer(payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      debugLog("WS not open, cannot send");
      return;
    }
    ws.send(JSON.stringify(payload));
  }

  // ===== チャット送信 =====
  function sendChat() {
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;
    chatInput.value = "";
    sendToServer({
      type: "chat",
      text,
      name: getStoredName() || null,
    });
  }

  // ===== 音声周り =====
  async function ensureMediaStream() {
    if (mediaStream) return mediaStream;
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      mediaStream = s;
      return s;
    } catch (e) {
      debugLog("getUserMedia error:", e.message || e);
      alert(
        t(
          "lobby.micErrorMsg",
          "マイクへのアクセスが許可されませんでした。ブラウザの設定を確認してください。"
        )
      );
      return null;
    }
  }

  async function joinVoice() {
    if (voiceJoined) return;
    const s = await ensureMediaStream();
    if (!s) return;
    voiceJoined = true;
    voiceSendState = "off";
    updateVoiceUI();
    sendToServer({ type: "voice", subtype: "join" });
  }

  async function leaveVoice() {
    if (!voiceJoined) return;
    voiceJoined = false;
    voiceSendState = "off";
    updateVoiceUI();
    sendToServer({ type: "voice", subtype: "leave" });
  }

  async function toggleMic() {
    if (!voiceJoined) {
      await joinVoice();
      return;
    }
    voiceSendState = voiceSendState === "on" ? "off" : "on";
    updateVoiceUI();
    sendToServer({
      type: "voice",
      subtype: "mic-state",
      state: voiceSendState,
    });
  }

  function askButlerByVoice() {
    sendToServer({ type: "voice", subtype: "ask" });
    if (voiceAskStatus)
      voiceAskStatus.textContent = t(
        "lobby.voiceAskWaiting",
        "執事が考え中です…"
      );
  }

  // ===== イベント登録 =====
  window.addEventListener("load", () => {
    // ロビー情報の読み込み
    fetchLobbyInfo();
    setupCountdown();

    // ニックネーム初期値
    const storedName = getStoredName();
    if (storedName && voiceNameLabel) {
      voiceNameLabel.textContent = storedName;
    }

    // ニックネーム設定ボタン
    if (setNameBtn) {
      setNameBtn.addEventListener("click", () => {
        const current = getStoredName();
        const name = prompt(
          t("lobby.namePrompt", "ニックネームを入力してください。"),
          current || ""
        );
        if (!name) return;
        setStoredName(name);
        if (voiceNameLabel) voiceNameLabel.textContent = name;
      });
    }

    // 入室ボタン
    const enterBtn2 = $("#enter");
    if (enterBtn2) {
      enterBtn2.addEventListener("click", () => {
        if (!target) {
          alert(
            t(
              "lobby.noTourUrl",
              "ツアーURLが設定されていません。主催者にご確認ください。"
            )
          );
          return;
        }
        // a 要素の href に任せる（target="_top"）
      });
    }

    // URLコピー
    const copyBtn = $("#copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(location.href);
          alert(
            t("lobby.copied", "この待合室のURLをコピーしました。")
          );
        } catch (e) {
          debugLog("clipboard error:", e.message || e);
          alert(
            t(
              "lobby.copyFailed",
              "コピーに失敗しました。手動でURLをコピーしてください。"
            )
          );
        }
      });
    }

    // チャット
    if (chatSendBtn) {
      chatSendBtn.addEventListener("click", () => {
        sendChat();
      });
    }
    if (chatInput) {
      chatInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" && !ev.isComposing) {
          ev.preventDefault();
          sendChat();
        }
      });
    }

    // 音声トグル
    if (voiceToggle) {
      voiceToggle.addEventListener("click", () => {
        if (!voiceJoined) {
          joinVoice();
        } else {
          leaveVoice();
        }
      });
    }

    if (voiceAskBtn) {
      voiceAskBtn.addEventListener("click", () => {
        askButlerByVoice();
      });
    }

    // WebSocket 接続
    connectWebSocket();
  });
})();
