// ===== 共通ヘルパー・定数 =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

// i18n 用簡易辞書
const I18N = {
  ja: {
    lobby: {
      title: "待合室",
      header: "待合室",
      statusWaiting: "開始までお待ちください。",
      statusDuring: "消滅まで後{minutes}分",
      statusEnded: "この待合室は終了しました。",
      createRoom: "待合室を作成",
      roomListTitle: "現在の待合室一覧",
      roomListEmpty: "現在、表示できる待合室はありません。",
      joinRoom: "入室する",
      goToTour: "ツアーに行く",
      copied: "コピーしました。",
      copyFailed: "コピーに失敗しました。",
      connectionLost: "接続が切断されました。ページを再読み込みしてください。",
      connecting: "接続中...",
      connected: "接続しました。",
      you: "あなた",
      messagePlaceholder: "メッセージを入力...",
      send: "送信",
      rosterTitle: "参加者一覧",
      rosterEmpty: "まだ参加者はいません。",
      rosterCount: "{count}名が参加中",
      roomInfoTitle: "待合室情報",
      roomInfoStart: "開始日時",
      roomInfoLimit: "参加上限",
      roomInfoTarget: "目的地URL",
      roomInfoEventType: "種類",
      roomInfoEventTypeFree: "無料",
      roomInfoEventTypePaid: "有料",
      roomInfoPrice: "価格",
      roomInfoOwner: "作成者",
      roomInfoNotSet: "未設定",
      voiceAskButton: "音声で質問",
      voiceAskNotSupported:
        "お使いのブラウザでは音声での質問機能はご利用いただけません。",
      voiceAskReady: "ボタンを押してからお話しください。",
      voiceAskRecording: "お話しください（もう一度ボタンを押すと終了します）",
      voiceAskNoText:
        "音声が認識できませんでした。もう一度お試しください。",
      voiceAskError: "音声認識中にエラーが発生しました。",
      voiceAskTooShort:
        "音声が短すぎるか、認識できませんでした。",
      voiceAskSent: "音声でのご質問を送信しました。",
    },
  },
  en: {
    lobby: {
      title: "Lobby",
      header: "Lobby",
      statusWaiting: "Please wait until the event starts.",
      statusDuring: "This room will vanish in {minutes} minutes",
      statusEnded: "This lobby has already ended.",
      createRoom: "Create Lobby",
      roomListTitle: "Current Lobbies",
      roomListEmpty: "There are no lobbies available at the moment.",
      joinRoom: "Join",
      goToTour: "Go to Tour",
      copied: "Copied to clipboard.",
      copyFailed: "Failed to copy.",
      connectionLost: "Connection lost. Please reload the page.",
      connecting: "Connecting...",
      connected: "Connected.",
      you: "You",
      messagePlaceholder: "Type a message...",
      send: "Send",
      rosterTitle: "Participants",
      rosterEmpty: "No one has joined yet.",
      rosterCount: "{count} participant(s) online",
      roomInfoTitle: "Lobby Info",
      roomInfoStart: "Start Time",
      roomInfoLimit: "Participant Limit",
      roomInfoTarget: "Destination URL",
      roomInfoEventType: "Type",
      roomInfoEventTypeFree: "Free",
      roomInfoEventTypePaid: "Paid",
      roomInfoPrice: "Price",
      roomInfoOwner: "Host",
      roomInfoNotSet: "Not set",
      voiceAskButton: "Ask by voice",
      voiceAskNotSupported:
        "Your browser does not support voice questions.",
      voiceAskReady: "Press the button and then speak.",
      voiceAskRecording:
        "Please speak. Press the button again to finish.",
      voiceAskNoText:
        "No speech was recognized. Please try again.",
      voiceAskError: "An error occurred during speech recognition.",
      voiceAskTooShort:
        "Your speech was too short or could not be recognized.",
      voiceAskSent: "Your voice question has been sent.",
    },
  },
};

let currentLang = "ja";

function t(key, fallback) {
  const parts = key.split(".");
  let cur = I18N[currentLang] || {};
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return fallback !== undefined ? fallback : key;
    }
  }
  if (typeof cur === "string") return cur;
  return fallback !== undefined ? fallback : key;
}

function setLang(newLang) {
  currentLang = newLang === "en" ? "en" : "ja";
}

// ===== URL パラメータ取得 =====
function getQueryParam(name) {
  const url = new URL(window.location.href);
  return url.searchParams.get(name);
}

// ===== WebSocket ラッパ =====
class LobbySocket {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.onMessage = null;
    this.onOpen = null;
    this.onClose = null;
  }

  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.addEventListener("open", () => {
      if (this.onOpen) this.onOpen();
    });

    ws.addEventListener("message", (ev) => {
      if (!this.onMessage) return;
      try {
        const data = JSON.parse(ev.data);
        this.onMessage(data);
      } catch (e) {
        console.error("WS message parse error", e);
      }
    });

    ws.addEventListener("close", () => {
      if (this.onClose) this.onClose();
    });

    ws.addEventListener("error", () => {
      if (this.onClose) this.onClose();
    });
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(obj));
  }

  close() {
    if (this.ws) this.ws.close();
  }
}

// ===== メイン処理 =====
(function () {
  // DOM 取得
  const statusEl = $("#status");
  const rosterCountEl = $("#roster-count");
  const rosterListEl = $("#roster-list");
  const chatLog = $("#chat-log");
  const chatInput = $("#chat-input");
  const chatSend = $("#chat-send");
  const roomTitleEl = $("#room-title");
  const roomInfoStartEl = $("#room-info-start");
  const roomInfoLimitEl = $("#room-info-limit");
  const roomInfoTargetEl = $("#room-info-target");
  const roomInfoEventTypeEl = $("#room-info-event-type");
  const roomInfoPriceEl = $("#room-info-price");
  const roomInfoOwnerEl = $("#room-info-owner");
  const goTourBtn = $("#go-tour");
  const copyUrlBtn = $("#copy-url");
  const connectionStatus = $("#connection-status");
  const voiceAskBtn = $("#voice-ask-btn");
  const voiceAskStatus = $("#voice-ask-status");

  // 言語設定
  const langParam = getQueryParam("lang");
  if (langParam === "en") {
    setLang("en");
    document.documentElement.lang = "en";
  } else {
    setLang("ja");
    document.documentElement.lang = "ja";
  }

  // タイトルやラベルの多言語化
  function applyStaticTexts() {
    const title = t("lobby.title", "待合室");
    document.title = title;
    const h1 = $("#page-title");
    if (h1) h1.textContent = t("lobby.header", "待合室");

    if (chatInput) {
      chatInput.placeholder = t(
        "lobby.messagePlaceholder",
        "メッセージを入力..."
      );
    }
    if (chatSend) {
      chatSend.textContent = t("lobby.send", "送信");
    }
    const rosterTitle = $("#roster-title");
    if (rosterTitle) {
      rosterTitle.textContent = t("lobby.rosterTitle", "参加者一覧");
    }
    const roomInfoTitle = $("#room-info-title");
    if (roomInfoTitle) {
      roomInfoTitle.textContent = t("lobby.roomInfoTitle", "待合室情報");
    }
    if (goTourBtn) {
      goTourBtn.textContent = t("lobby.goToTour", "ツアーに行く");
    }
    if (copyUrlBtn) {
      copyUrlBtn.textContent = t("lobby.joinRoom", "入室用URLをコピー");
    }
    if (voiceAskBtn) {
      voiceAskBtn.textContent = t("lobby.voiceAskButton", "音声で質問");
    }
  }
  applyStaticTexts();

  // URL から待合室パラメータ取得
  const roomId = getQueryParam("roomId") || "default";
  const titleParam = getQueryParam("title") || "";
  const startParam = getQueryParam("start") || "";
  const limitParam = getQueryParam("limit") || "";
  const targetParam = getQueryParam("target") || "";
  const ownerParam = getQueryParam("owner") || "";
  const eventTypeParam = getQueryParam("eventType") || "";
  const priceParam = getQueryParam("price") || "";

  // タイトルなど反映
  if (roomTitleEl) {
    roomTitleEl.textContent = titleParam || t("lobby.roomInfoNotSet", "未設定");
  }

  if (roomInfoStartEl) {
    if (startParam) {
      const d = new Date(startParam);
      roomInfoStartEl.textContent = d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      });
    } else {
      roomInfoStartEl.textContent = t("lobby.roomInfoNotSet", "未設定");
    }
  }

  if (roomInfoLimitEl) {
    roomInfoLimitEl.textContent = limitParam || t("lobby.roomInfoNotSet", "未設定");
  }

  if (roomInfoTargetEl) {
    roomInfoTargetEl.textContent =
      targetParam || t("lobby.roomInfoNotSet", "未設定");
  }

  if (roomInfoEventTypeEl) {
    if (eventTypeParam === "free") {
      roomInfoEventTypeEl.textContent = t("lobby.roomInfoEventTypeFree", "無料");
    } else if (eventTypeParam === "paid") {
      roomInfoEventTypeEl.textContent = t("lobby.roomInfoEventTypePaid", "有料");
    } else {
      roomInfoEventTypeEl.textContent = t("lobby.roomInfoNotSet", "未設定");
    }
  }

  if (roomInfoPriceEl) {
    if (priceParam && priceParam.trim().length > 0) {
      roomInfoPriceEl.textContent = priceParam;
    } else {
      roomInfoPriceEl.textContent = t("lobby.roomInfoNotSet", "未設定");
    }
  }

  if (roomInfoOwnerEl) {
    roomInfoOwnerEl.textContent =
      ownerParam || t("lobby.roomInfoNotSet", "未設定");
  }

  // 開始時刻からステータス表示を更新
  const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;
  let startDate = startParam ? new Date(startParam) : null;

  function pad(n) {
    return n < 10 ? "0" + n : "" + n;
  }

  function updateStatusLoop() {
    if (!statusEl || !startDate) return;
    function update() {
      const now = new Date();
      if (!startDate) return;

      const diffMs = startDate - now;
      if (diffMs > 0) {
        const remainMin = Math.ceil(diffMs / 60000);
        const label = t(
          "lobby.statusWaiting",
          "開始までお待ちください。"
        );
        statusEl.textContent = label;
        requestAnimationFrame(update);
        return;
      }

      const expireAt = new Date(startDate.getTime() + NEGATIVE_LIMIT_MS);
      const remainMs = expireAt - now;
      if (remainMs > 0) {
        const remainMin = Math.ceil(remainMs / 60000);
        const label = t(
          "lobby.statusDuring",
          "消滅まで後{minutes}分"
        ).replace("{minutes}", pad(remainMin));
        statusEl.textContent = label;
        requestAnimationFrame(update);
        return;
      }

      statusEl.textContent = t(
        "lobby.statusEnded",
        "この待合室は終了しました。"
      );
    }
    update();
  }

  if (startDate) {
    updateStatusLoop();
  } else if (statusEl) {
    statusEl.textContent = t("lobby.statusWaiting", "開始までお待ちください。");
  }

  // ===== WebSocket 接続 =====
  const wsUrlBase = location.origin.replace(/^http/, "ws");
  const userName = getQueryParam("user") || "Guest";

  const wsUrl =
    wsUrlBase +
    `/ws/${encodeURIComponent(roomId)}?user=${encodeURIComponent(
      userName
    )}&title=${encodeURIComponent(titleParam)}&start=${encodeURIComponent(
      startParam
    )}&limit=${encodeURIComponent(limitParam)}&target=${encodeURIComponent(
      targetParam
    )}&eventType=${encodeURIComponent(
      eventTypeParam
    )}&price=${encodeURIComponent(priceParam)}`;

  const socket = new LobbySocket(wsUrl);

  let myId = null;

  function setConnectionStatus(text) {
    if (connectionStatus) {
      connectionStatus.textContent = text;
    }
  }

  socket.onOpen = () => {
    setConnectionStatus(t("lobby.connected", "接続しました。"));
  };

  socket.onClose = () => {
    setConnectionStatus(
      t("lobby.connectionLost", "接続が切断されました。ページを再読み込みしてください。")
    );
  };

  function linkify(text) {
    if (!text) return "";
    const urlRegex =
      /(https?:\/\/[^\s]+)/g;
    return text.replace(
      urlRegex,
      '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
    );
  }

  function addMsg(elClass, text) {
    const div = document.createElement("div");
    div.className = "msg " + elClass;
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function updateRoster(payload) {
    if (!rosterListEl || !rosterCountEl) return;
    const { count, members } = payload;
    rosterListEl.innerHTML = "";
    if (!members || members.length === 0) {
      const li = document.createElement("li");
      li.textContent = t("lobby.rosterEmpty", "まだ参加者はいません。");
      rosterListEl.appendChild(li);
    } else {
      for (const m of members) {
        const li = document.createElement("li");
        if (m.id === myId) {
          li.textContent = t("lobby.you", "あなた");
        } else {
          li.textContent = m.name || "Guest";
        }
        rosterListEl.appendChild(li);
      }
    }
    const label = t("lobby.rosterCount", "{count}名が参加中").replace(
      "{count}",
      String(count ?? members.length ?? 0)
    );
    rosterCountEl.textContent = label;
  }

  socket.onMessage = (data) => {
    if (data.sys && data.type === "welcome") {
      myId = data.id;
      return;
    }

    if (data.sys && data.type === "history" && Array.isArray(data.messages)) {
      for (const s of data.messages) {
        try {
          const m = JSON.parse(s);
          if (m && typeof m === "object" && m.text) {
            const cls = m.name === "Reginald" ? "msg-bot" : "msg-user";
            addMsg(cls, m.text);
          }
        } catch {}
      }
      return;
    }

    if (data.sys && data.type === "roster") {
      updateRoster(data);
      return;
    }

    if (data.sys && data.type === "join") {
      updateRoster(data);
      return;
    }

    if (data.sys && data.type === "leave") {
      updateRoster(data);
      return;
    }

    if (data.type === "message") {
      const cls = data.name === "Reginald" ? "msg-bot" : "msg-user";
      addMsg(cls, data.text || "");
    }
  };

  setConnectionStatus(t("lobby.connecting", "接続中..."));
  socket.connect();

  // ===== チャット送信 =====
  function sendChat() {
    const text = (chatInput.value || "").trim();
    if (!text) return;
    socket.send(text);
    chatInput.value = "";
  }

  if (chatSend) {
    chatSend.addEventListener("click", (e) => {
      e.preventDefault();
      sendChat();
    });
  }

  if (chatInput) {
    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });
  }

  // ===== 「ツアーに行く」ボタン =====
  if (goTourBtn) {
    goTourBtn.addEventListener("click", () => {
      if (targetParam) {
        window.open(targetParam, "_blank", "noopener,noreferrer");
      } else {
        alert(t("lobby.roomInfoNotSet", "未設定です。"));
      }
    });
  }

  // ===== URL コピー =====
  if (copyUrlBtn) {
    copyUrlBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        alert(t("lobby.copied", "コピーしました。"));
      } catch (e) {
        console.error(e);
        alert(t("lobby.copyFailed", "コピーに失敗しました。"));
      }
    });
  }

  // ===== 音声で質問（Web Speech API） =====
  let recognition = null;
  let recognizing = false;
  let gotResult = false;

  function setupVoiceAsk() {
    if (!voiceAskBtn || !voiceAskStatus) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      voiceAskBtn.style.display = "none";
      voiceAskStatus.textContent = t(
        "lobby.voiceAskNotSupported",
        "お使いのブラウザでは音声での質問機能はご利用いただけません。"
      );
      return;
    }

    recognition = new SR();
    recognition.lang =
      currentLang === "ja" || currentLang === "ja-JP" ? "ja-JP" : "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    recognition.onstart = () => {
      recognizing = true;
      gotResult = false;
      voiceAskBtn.classList.add("active");
      voiceAskStatus.textContent = t(
        "lobby.voiceAskRecording",
        "お話しください（もう一度ボタンを押すと終了します）"
      );
    };

    recognition.onresult = (ev) => {
      gotResult = true;
      let text = "";
      for (let i = 0; i < ev.results.length; i++) {
        text += ev.results[i][0].transcript;
      }
      text = (text || "").trim();
      if (text) {
        chatInput.value = text;
        chatSend.click();
        voiceAskStatus.textContent = t(
          "lobby.voiceAskSent",
          "音声でのご質問を送信しました。"
        );
      } else {
        voiceAskStatus.textContent = t(
          "lobby.voiceAskNoText",
          "音声が認識できませんでした。もう一度お試しください。"
        );
      }
    };

    recognition.onerror = (ev) => {
      console.error("speech error", ev);
      recognizing = false;
      voiceAskBtn.classList.remove("active");
      voiceAskStatus.textContent = t(
        "lobby.voiceAskError",
        "音声認識中にエラーが発生しました。"
      );
    };

    recognition.onend = () => {
      recognizing = false;
      voiceAskBtn.classList.remove("active");
      if (!gotResult) {
        voiceAskStatus.textContent = t(
          "lobby.voiceAskTooShort",
          "音声が短すぎるか、認識できませんでした。"
        );
      }
    };

    const startRec = () => {
      if (!recognition) return;
      if (recognizing) {
        try {
          recognition.stop();
        } catch (_) {}
        return;
      }
      try {
        recognition.start();
      } catch (e) {
        console.error("speech start error", e);
      }
    };

    const stopRec = () => {
      if (!recognition) return;
      if (!recognizing) return;
      try {
        recognition.stop();
      } catch (e) {
        console.error("speech stop error", e);
      }
    };

    voiceAskBtn.addEventListener("click", (e) => {
      e.preventDefault();
      startRec();
    });
  }
  setupVoiceAsk();
})();
