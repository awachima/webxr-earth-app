// ===== 共通ヘルパー・定数 =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

/**
 * DOM が存在する場合のみ textContent を更新するヘルパー
 */
function setTextIfExists(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

/**
 * DOM が存在する場合のみ innerHTML を更新するヘルパー
 */
function setHTMLIfExists(selector, html) {
  const el = $(selector);
  if (el) el.innerHTML = html;
}

/**
 * DOM が存在する場合のみ value を更新するヘルパー
 */
function setValueIfExists(selector, value) {
  const el = $(selector);
  if (el) el.value = value;
}

/**
 * DOM が存在する場合のみ placeholder を更新するヘルパー
 */
function setPlaceholderIfExists(selector, value) {
  const el = $(selector);
  if (el) el.placeholder = value;
}

/**
 * DOM が存在する場合のみ title を更新するヘルパー
 */
function setTitleIfExists(selector, value) {
  const el = $(selector);
  if (el) el.title = value;
}

/**
 * DOM が存在する場合のみ aria-label を更新するヘルパー
 */
function setAriaLabelIfExists(selector, value) {
  const el = $(selector);
  if (el) el.setAttribute("aria-label", value);
}

/**
 * DOM が存在する場合のみ dataset 属性を更新するヘルパー
 */
function setDatasetIfExists(selector, key, value) {
  const el = $(selector);
  if (el) el.dataset[key] = value;
}

/**
 * DOM が存在する場合のみ disabled を更新するヘルパー
 */
function setDisabledIfExists(selector, disabled) {
  const el = $(selector);
  if (el) el.disabled = disabled;
}

/**
 * DOM が存在する場合のみ classList.toggle するヘルパー
 */
function toggleClassIfExists(selector, className, flag) {
  const el = $(selector);
  if (el) el.classList.toggle(className, flag);
}

// ===== ストア関連 =====
const STORAGE_KEY = "meetups-store-v2";
const OWNER_KEY = "meetups-owners"; // roomId -> ownerId
const NEGATIVE_LIMIT_MS = 20 * 60 * 1000; // -20分を下回ったら自動削除

/**
 * ストアからロビー一覧を取得
 */
function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr;
  } catch (e) {
    console.error("readStore error", e);
    return [];
  }
}

/**
 * ストアへロビー一覧を書き込み
 */
function writeStore(list) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch (e) {
    console.error("writeStore error", e);
  }
}

/**
 * roomId -> ownerId のマップを読み出す
 */
function readOwners() {
  try {
    const raw = localStorage.getItem(OWNER_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== "object") return {};
    return obj;
  } catch (e) {
    console.error("readOwners error", e);
    return {};
  }
}

/**
 * roomId -> ownerId のマップを書き出す
 */
function writeOwners(map) {
  try {
    localStorage.setItem(OWNER_KEY, JSON.stringify(map));
  } catch (e) {
    console.error("writeOwners error", e);
  }
}

/**
 * 指定された roomId のロビーをストアから削除
 */
function autoDeleteRoom(roomId) {
  if (!roomId) return;
  const list = readStore();
  const filtered = list.filter((x) => x.roomId !== roomId);
  writeStore(filtered);

  const owners = readOwners();
  delete owners[roomId];
  writeOwners(owners);
}

// ===== クエリパラメータ取得 =====
const params = new URLSearchParams(location.search);
const roomId = params.get("roomId") || "";
const ownerId = params.get("owner") || "";
const langFromQuery = params.get("lang") || "";

// ===== 言語設定（index.html からの引き継ぎ） =====
let currentLang =
  localStorage.getItem("dokodemodoors.lang") ||
  navigator.language ||
  "en";

// クエリに lang があればそれを優先して反映
if (langFromQuery) {
  currentLang = langFromQuery;
  localStorage.setItem("dokodemodoors.lang", currentLang);
}

// ===== i18n ヘルパー =====
/**
 * i18n データからパスをたどって文字列を取得する。
 * 例: t("lobby.enterButton", "ツアーに行く")
 */
function t(path, fallback) {
  const data = window.i18n || {};
  const parts = path.split(".");
  let cur = data;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return fallback;
    }
  }
  return typeof cur === "string" ? cur : fallback;
}

// ===== ページ初期化 =====
(function () {
  const roomIdEl = $("#roomId");
  if (roomIdEl && roomId) {
    roomIdEl.textContent = `Room ID: ${roomId}`;
  }

  // ニックネーム設定ボタン
  const setNameBtn = $("#setName");
  if (setNameBtn) {
    setNameBtn.addEventListener("click", () => {
      const current = localStorage.getItem("nickname") || "";
      const name = prompt(
        t("lobby.nicknamePrompt", "ニックネームを入力してください。"),
        current
      );
      if (name !== null && name.trim() !== "") {
        localStorage.setItem("nickname", name.trim());
        setNameBtn.textContent =
          t("lobby.nicknameButton", "ニックネーム") + ` (${name.trim()})`;
      }
    });

    // 初期表示（既にニックネームがある場合）
    const saved = localStorage.getItem("nickname");
    if (saved && saved.trim() !== "") {
      setNameBtn.textContent =
        t("lobby.nicknameButton", "ニックネーム") + ` (${saved.trim()})`;
    } else {
      setNameBtn.textContent = t("lobby.nicknameButton", "ニックネーム");
    }
  }

  // ===== ロビー情報の取得 =====
  const titleEl = $("#title");
  const metaEl = $("#meta");
  const countdownEl = $("#count");
  const mainStatusEl = $("#status");
  const debugEl = $("#debug");

  const dateValue = $("#dateValue");
  const limitValue = $("#limitValue");
  const urlValue = $("#urlValue");
  const eventTypeValue = $("#eventTypeValue");
  const priceValue = $("#priceValue");

  let startTime = null;
  let limit = null;
  let tourUrl = "";
  let eventType = "";
  let price = "";
  let countdownTimer = null;

  function logDebug(msg) {
    if (!debugEl) return;
    const now = new Date().toISOString();
    debugEl.textContent += `[${now}] ${msg}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  /**
   * ロビー情報 API を叩く
   */
  async function fetchLobbyInfo() {
    if (!roomId) {
      logDebug("roomId が指定されていません。");
      return;
    }

    const url = `/db-chat/info?roomId=${encodeURIComponent(roomId)}`;
    logDebug(`GET ${url}`);

    try {
      const res = await fetch(url);
      if (!res.ok) {
        logDebug(`info API error: ${res.status}`);
        return;
      }
      const data = await res.json();
      logDebug("info API response: " + JSON.stringify(data));

      const { title, start, limit: l, url: u, eventType: et, price: p } = data;

      if (titleEl) {
        titleEl.textContent = title || t("lobby.noTitle", "（タイトル未設定）");
      }

      startTime = start || null;
      limit = typeof l === "number" ? l : null;
      tourUrl = u || "";
      eventType = et || "";
      price = p || "";

      updateInfoDisplay();
      setupCountdown();

      // 「ツアーに行く」ボタンの URL はここで設定
      const enterBtn = $("#enterBtn");
      if (enterBtn) {
        if (tourUrl) {
          enterBtn.href = tourUrl;
          enterBtn.target = "_top";
          enterBtn.rel = "noopener";
        } else {
          enterBtn.href = "#";
        }
      }
    } catch (e) {
      console.error(e);
      logDebug("info API fetch error: " + e);
    }
  }

  /**
   * 「開始時刻」などの情報表示を更新
   */
  function updateInfoDisplay() {
    const start = startTime;

    if (metaEl) {
      const label = t("lobby.startLabel", "開始時刻：");
      if (start) {
        const d = new Date(start);
        if (!isNaN(d.getTime())) {
          const dateText = d.toLocaleString(undefined, {
            timeZone: "Asia/Tokyo",
          });
          metaEl.textContent = label + dateText;
        } else {
          metaEl.textContent = label + "—";
        }
      } else {
        metaEl.textContent = label + "—";
      }
    }

    // 右側の詳細パネル
    if (dateValue) {
      if (start) {
        const d = new Date(start);
        if (!isNaN(d.getTime())) {
          dateValue.textContent = d.toLocaleString(undefined, {
            timeZone: "Asia/Tokyo",
          });
        } else {
          dateValue.textContent = t("lobby.dateUnknown", "未設定");
        }
      } else {
        dateValue.textContent = t("lobby.dateUnknown", "未設定");
      }
    }

    if (limitValue) {
      if (typeof limit === "number" && limit > 0) {
        limitValue.textContent = `${limit}${t("lobby.peopleUnit", "人まで")}`;
      } else {
        limitValue.textContent = t("lobby.limitNone", "制限なし");
      }
    }

    if (urlValue) {
      urlValue.textContent = tourUrl || t("lobby.urlUnknown", "未設定");
    }

    if (eventTypeValue) {
      eventTypeValue.textContent =
        eventType || t("lobby.eventTypeUnknown", "未設定");
    }

    if (priceValue) {
      priceValue.textContent = price || t("lobby.priceUnknown", "未設定");
    }
  }

  /**
   * カウントダウンのセットアップ
   */
  function setupCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }

    if (!startTime || !countdownEl || !mainStatusEl) return;

    const start = new Date(startTime);
    if (isNaN(start.getTime())) return;

    function update() {
      const now = new Date();
      const diff = start.getTime() - now.getTime();

      if (diff <= -NEGATIVE_LIMIT_MS) {
        // 開始時刻から一定時間過ぎたら自動削除
        autoDeleteRoom(roomId);
        if (countdownEl) countdownEl.textContent = "00:00:00";
        if (mainStatusEl)
          mainStatusEl.textContent = t(
            "lobby.roomExpired",
            "この待合室の有効期限が切れました。"
          );
        clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }

      if (diff <= 0) {
        if (countdownEl) countdownEl.textContent = "00:00:00";
        if (mainStatusEl)
          mainStatusEl.textContent = t(
            "lobby.countdownFinished",
            "ツアー開始時刻になりました。"
          );
        return;
      }

      const totalSec = Math.floor(diff / 1000);
      const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
      const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
      const s = String(totalSec % 60).padStart(2, "0");

      countdownEl.textContent = `${h}:${m}:${s}`;
      mainStatusEl.textContent = t(
        "lobby.countdownWaiting",
        "開始までお待ちください。"
      );
    }

    update();
    countdownTimer = setInterval(update, 1000);
  }

  // ===== 「ツアーに行く」「URLコピー」ボタン =====
  const enterBtn = $("#enterBtn");
  if (enterBtn) {
    enterBtn.addEventListener("click", (ev) => {
      if (!tourUrl) {
        ev.preventDefault();
        return;
      }
      // リンクとして通常遷移（target, rel は fetchLobbyInfo で設定）
    });
  }

  const copyRoomUrlBtn = $("#copyRoomUrl");
  if (copyRoomUrlBtn) {
    copyRoomUrlBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        alert(t("lobby.copiedUrl", "この待合室のURLをコピーしました。"));
      } catch (e) {
        console.error(e);
        alert(t("lobby.copyFailed", "コピーに失敗しました。"));
      }
    });
  }

  // ===== テキストチャット WebSocket =====
  const chatLogEl = $("#chatLog");
  const chatInput = $("#chatInput");
  const chatSendBtn = $("#chatSend");
  const chatStatusEl = $("#chatStatus");

  let ws = null;
  let wsConnected = false;

  /**
   * ログに 1 行追加
   */
  function appendLogLine(line) {
    if (!chatLogEl) return;
    const div = document.createElement("div");
    div.className = "chat-line";

    if (line.type === "system") {
      div.classList.add("system");
      div.textContent = line.text;
    } else if (line.type === "user") {
      const nameSpan = document.createElement("span");
      nameSpan.className = "name";
      nameSpan.textContent = line.name || "";

      const textSpan = document.createElement("span");
      textSpan.className = "text";
      textSpan.textContent = line.text || "";

      div.appendChild(nameSpan);
      div.appendChild(textSpan);
    } else if (line.type === "robo") {
      div.classList.add("robo");
      div.textContent = line.text;
    }
    chatLogEl.appendChild(div);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function updateWsStatusLabel() {
    const el = $("#wsStatus");
    if (!el) return;
    const state = wsConnected
      ? t("lobby.connConnected", "接続中")
      : t("lobby.connDisconnected", "未接続");
    el.textContent = t("lobby.connLabel", "接続状態: {state}").replace(
      "{state}",
      state
    );
  }

  function openWebSocket() {
    if (!roomId) {
      logDebug("roomId が指定されていないため WebSocket を開きません。");
      return;
    }

    const loc = window.location;
    const protocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const host = loc.host;
    const path = "/db-chat/ws";

    const wsUrl =
      protocol +
      "//" +
      host +
      path +
      "?roomId=" +
      encodeURIComponent(roomId) +
      "&lang=" +
      encodeURIComponent(currentLang);

    logDebug("WebSocket connect: " + wsUrl);

    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      wsConnected = true;
      if (chatStatusEl)
        chatStatusEl.textContent = t("lobby.chatConnected", "接続しました。");
      updateWsStatusLabel();
    });

    ws.addEventListener("close", () => {
      wsConnected = false;
      if (chatStatusEl)
        chatStatusEl.textContent = t(
          "lobby.chatDisconnected",
          "切断されました。再読み込みしてください。"
        );
      updateWsStatusLabel();
    });

    ws.addEventListener("error", () => {
      wsConnected = false;
      if (chatStatusEl)
        chatStatusEl.textContent = t(
          "lobby.chatError",
          "エラーが発生しました。しばらく待ってから再度お試しください。"
        );
      updateWsStatusLabel();
    });

    ws.addEventListener("message", (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        handleServerEvent(msg);
      } catch (e) {
        console.error("ws message error", e);
      }
    });
  }

  function sendChatMessage() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!chatInput) return;
    const text = chatInput.value.trim();
    if (!text) return;

    const nickname = localStorage.getItem("nickname") || "guest";

    const payload = {
      type: "chat",
      text,
      name: nickname,
    };
    ws.send(JSON.stringify(payload));
    chatInput.value = "";
  }

  if (chatSendBtn) {
    chatSendBtn.addEventListener("click", sendChatMessage);
  }
  if (chatInput) {
    chatInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) {
        ev.preventDefault();
        sendChatMessage();
      }
    });
  }

  /**
   * サーバーからのイベントを処理
   */
  const membersEl = $("#members");

  function handleServerEvent(msg) {
    if (!msg || typeof msg !== "object") return;

    switch (msg.type) {
      case "log":
        if (Array.isArray(msg.lines)) {
          for (const line of msg.lines) {
            appendLogLine(line);
          }
        }
        break;
      case "countdown":
        if (typeof msg.remaining === "number") {
          const ms = msg.remaining;
          if (ms <= 0) {
            if (countdownEl) countdownEl.textContent = "00:00:00";
            if (mainStatusEl)
              mainStatusEl.textContent = t(
                "lobby.countdownFinished",
                "ツアー開始時刻になりました。"
              );
          } else {
            const totalSec = Math.floor(ms / 1000);
            const h = String(Math.floor(totalSec / 3600)).padStart(2, "0");
            const m = String(Math.floor((totalSec % 3600) / 60)).padStart(
              2,
              "0"
            );
            const s = String(totalSec % 60).padStart(2, "0");
            if (countdownEl) countdownEl.textContent = `${h}:${m}:${s}`;
            if (mainStatusEl)
              mainStatusEl.textContent = t(
                "lobby.countdownWaiting",
                "開始までお待ちください。"
              );
          }
        }
        break;
      case "roomInfo":
        startTime = msg.start || null;
        limit = msg.limit ?? null;
        tourUrl = msg.url || "";
        eventType = msg.eventType || "";
        price = msg.price || "";
        updateInfoDisplay();
        setupCountdown();
        // 「ツアーに行く」ボタンの URL 更新
        if (enterBtn) {
          if (tourUrl) {
            enterBtn.href = tourUrl;
            enterBtn.target = "_top";
            enterBtn.rel = "noopener";
          } else {
            enterBtn.href = "#";
          }
        }
        break;
      case "system":
        appendLogLine({ type: "system", text: msg.text || "" });
        break;
      case "robo":
        appendLogLine({ type: "robo", text: msg.text || "" });
        break;
      case "user":
        appendLogLine({
          type: "user",
          name: msg.name || "",
          text: msg.text || "",
        });
        break;
      case "voiceMembers":
        if (membersEl && Array.isArray(msg.members)) {
          membersEl.innerHTML = "";
          for (const m of msg.members) {
            const div = document.createElement("div");
            div.className = "member";
            div.textContent = m.name || "(unknown)";
            membersEl.appendChild(div);
          }
        }
        break;
      default:
        break;
    }
  }

  // WebSocket を開く
  openWebSocket();

  // ===== 音声チャット関連 =====
  const voicePowerBtn = $("#voicePower");
  const micToggleBtn = $("#micToggle");
  const voiceHintEl = $("#voiceHint");
  const voiceStatusEl = $("#voiceStatus");
  const selfEchoCheckbox = $("#selfEcho");
  const voiceAutoJoinCheckbox = $("#voiceAutoJoin");

  let localStream = null;
  const peers = new Map(); // id -> RTCPeerConnection
  const remoteAudios = new Map(); // id -> HTMLAudioElement
  let voiceJoined = false;

  function updateVoiceUI() {
    if (voicePowerBtn) {
      voicePowerBtn.textContent = voiceJoined
        ? t("lobby.voiceOff", "音声OFF")
        : t("lobby.voiceOn", "音声ON");
    }
    if (voiceStatusEl) {
      voiceStatusEl.textContent = voiceJoined
        ? t("lobby.voiceJoined", "音声: 接続中")
        : t("lobby.voiceNone", "音声: 未参加");
    }
    if (voiceHintEl) {
      voiceHintEl.textContent = t(
        "lobby.voiceHint",
        "※ 音声はブラウザ同士で直接やり取りされます。"
      );
    }
  }

  updateVoiceUI();

  async function joinVoice() {
    if (voiceJoined) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      console.error("getUserMedia error", e);
      alert(
        t(
          "lobby.voicePermissionError",
          "マイクへのアクセスが許可されませんでした。ブラウザの設定を確認してください。"
        )
      );
      return;
    }

    voiceJoined = true;
    updateVoiceUI();

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voiceJoin" }));
    }
  }

  function leaveVoice() {
    voiceJoined = false;
    updateVoiceUI();

    for (const [, pc] of peers) {
      pc.close();
    }
    peers.clear();

    for (const [, audio] of remoteAudios) {
      audio.srcObject = null;
    }
    remoteAudios.clear();

    if (localStream) {
      for (const track of localStream.getTracks()) track.stop();
      localStream = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "voiceLeave" }));
    }
  }

  if (voicePowerBtn) {
    voicePowerBtn.addEventListener("click", () => {
      if (!voiceJoined) {
        joinVoice();
      } else {
        leaveVoice();
      }
    });
  }

  if (micToggleBtn) {
    micToggleBtn.addEventListener("click", () => {
      if (!localStream) return;
      const enabled = localStream
        .getAudioTracks()
        .some((track) => track.enabled);
      for (const track of localStream.getAudioTracks()) {
        track.enabled = !enabled;
      }
      micToggleBtn.textContent = enabled
        ? t("lobby.unmute", "ミュート解除")
        : t("lobby.mute", "ミュート");
    });
  }

  if (selfEchoCheckbox) {
    selfEchoCheckbox.addEventListener("change", () => {
      const checked = selfEchoCheckbox.checked;
      localStorage.setItem("voiceSelfEcho", checked ? "1" : "0");
    });
    const saved = localStorage.getItem("voiceSelfEcho");
    if (saved === "1") selfEchoCheckbox.checked = true;
  }

  if (voiceAutoJoinCheckbox) {
    voiceAutoJoinCheckbox.addEventListener("change", () => {
      const checked = voiceAutoJoinCheckbox.checked;
      localStorage.setItem("voiceAutoJoin", checked ? "1" : "0");
    });
    const saved = localStorage.getItem("voiceAutoJoin");
    if (saved === "1") voiceAutoJoinCheckbox.checked = true;
  }

  // ===== 執事に質問（音声） =====
  const voiceAskBtn = $("#voiceAskBtn");
  const voiceAskStatus = $("#voiceAskStatus");

  if (voiceAskBtn) {
    voiceAskBtn.addEventListener("click", () => {
      if (!voiceJoined) {
        alert(
          t(
            "lobby.voiceAskNeedJoin",
            "まずボイスチャットに接続してからご利用ください。"
          )
        );
        return;
      }
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert(
          t(
            "lobby.voiceAskNoWs",
            "チャットサーバーに接続されていません。ページを再読み込みしてください。"
          )
        );
        return;
      }
      ws.send(JSON.stringify({ type: "voiceAskStart" }));
      if (voiceAskStatus) {
        voiceAskStatus.textContent = t(
          "lobby.voiceAskListening",
          "執事が音声を聞き取っています…"
        );
      }
    });
  }

  // ===== ラベル類の多言語テキスト適用 =====
  function applyLobbyTexts() {
    setTextIfExists(
      "#lobbyHeaderTitle",
      t("lobby.headerTitle", "待ち合わせロビー")
    );
    setTextIfExists("#backToIndex", t("lobby.backButton", "← 戻る"));

    const setNameBtn = $("#setName");
    if (setNameBtn) {
      const savedName = localStorage.getItem("nickname") || "";
      if (savedName) {
        setNameBtn.textContent =
          t("lobby.nicknameButton", "ニックネーム") + ` (${savedName})`;
      } else {
        setNameBtn.textContent = t("lobby.nicknameButton", "ニックネーム");
      }
    }

    setTextIfExists("#countdownLabel", t("lobby.countdownLabel", "カウントダウン"));
    setTextIfExists("#status", t("lobby.countdownWaiting", "開始までお待ちください。"));

    const enterBtn = $("#enterBtn");
    if (enterBtn)
      enterBtn.textContent = t("lobby.enterButton", "ツアーに行く");

    const chatSend = $("#chatSend");
    if (chatSend)
      chatSend.textContent = t("lobby.chatSend", "送信")

    // 「URLをコピー」ボタン
    const copyRoomUrlBtn = $("#copyRoomUrl");
    if (copyRoomUrlBtn)
      copyRoomUrlBtn.textContent = t(
        "lobby.copyRoomUrl",
        "この待合室のURLをコピー"
      );

    // 注意書きの小テキスト（2つをまとめて .notice-small で取得）
    const noticeSmalls = document.querySelectorAll(".notice-small");
    if (noticeSmalls[0]) {
      noticeSmalls[0].textContent = t(
        "lobby.voiceOnOffNotice",
        "🔊 音声はON/OFFで改善することがあります。"
      );
    }
    if (noticeSmalls[1]) {
      noticeSmalls[1].textContent = t(
        "lobby.voiceAskNotice",
        "🤵 ゆっくり・はっきり話すと認識が安定します。"
      );
    }

    const dateLabel = $("#dateLabel");
    if (dateLabel) {
      const defaultText = dateLabel.textContent || "開始日時";
      dateLabel.textContent = t("lobby.dateLabel", defaultText);
    }

    const limitLabel = $("#limitLabel");
    if (limitLabel) {
      const defaultText = limitLabel.textContent || "人数制限";
      limitLabel.textContent = t("lobby.limitLabel", defaultText);
    }

    const urlLabel = $("#urlLabel");
    if (urlLabel) {
      const defaultText = urlLabel.textContent || "ツアーURL";
      urlLabel.textContent = t("lobby.urlLabel", defaultText);
    }

    const eventTypeLabel = $("#eventTypeLabel");
    if (eventTypeLabel) {
      const defaultText = eventTypeLabel.textContent || "種別";
      eventTypeLabel.textContent = t("lobby.eventTypeLabel", defaultText);
    }

    const priceLabel = $("#priceLabel");
    if (priceLabel) {
      const defaultText = priceLabel.textContent || "料金";
      priceLabel.textContent = t("lobby.priceLabel", defaultText);
    }

    setTextIfExists("#infoPanelLabel", t("lobby.infoPanelLabel", "待合室の情報"));
    setTextIfExists(
      "#voicePanelLabel",
      t("lobby.voicePanelLabel", "音声・会話設定")
    );

    if (selfEchoCheckbox) {
      const labelSpan = $("#selfEchoLabel");
      if (labelSpan) {
        labelSpan.textContent = t(
          "lobby.selfEchoLabel",
          "自分の声を自分にも流す"
        );
      }
    }
    if (voiceAutoJoinCheckbox) {
      const labelSpan = $("#voiceAutoJoinLabel");
      if (labelSpan) {
        labelSpan.textContent = t(
          "lobby.voiceAutoJoinLabel",
          "入室時に自動で音声接続する"
        );
      }
    }

    if (voicePowerBtn) {
      voicePowerBtn.textContent = voiceJoined
        ? t("lobby.voiceOff", "音声OFF")
        : t("lobby.voiceOn", "音声ON");
    }
    if (micToggleBtn) {
      micToggleBtn.textContent = t("lobby.mute", "ミュート");
    }
    if (voiceStatusEl) {
      voiceStatusEl.textContent = voiceJoined
        ? t("lobby.voiceJoined", "音声: 接続中")
        : t("lobby.voiceNone", "音声: 未参加");
    }

    const enableSoundBtn = $("#enableSound");
    if (enableSoundBtn) {
      enableSoundBtn.textContent = t(
        "lobby.enableSound",
        "スマホで音を有効化"
      );
    }

    if (voiceHintEl) {
      voiceHintEl.textContent = t(
        "lobby.voiceHint",
        "※ 音声はブラウザ同士で直接やり取りされます。"
      );
    }

    const voiceAskBtnLocal = $("#voiceAskBtn");
    if (voiceAskBtnLocal) {
      voiceAskBtnLocal.textContent = t(
        "lobby.voiceAskBtn",
        "執事に質問（音声）"
      );
    }

    const footer = $("#lobbyFooter");
    if (footer) {
      footer.textContent = t("lobby.footer", "© DokodemoDoors");
    }
  }

  // ===== 言語ファイルの読み込み =====
  async function loadLangData(lang) {
    let url = "./lang/en.json";
    if (lang === "ja-JP" || lang === "ja") url = "./lang/ja.json";
    else if (lang === "zh-CN" || lang === "zh") url = "./lang/zh.json";
    else if (lang === "fa" || lang === "fa-IR") url = "./lang/fa.json";
    else if (lang === "hi" || lang === "hi-IN") url = "./lang/hi.json";
    else if (lang === "he" || lang === "he-IL") url = "./lang/he.json";

    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("lang load failed: " + res.status);
      const data = await res.json();
      window.i18n = data || {};
    } catch (e) {
      console.warn("lang load error", e);
      window.i18n = {};
    }
    applyLobbyTexts();
    updateInfoDisplay();
    updateVoiceUI();
  }

  // 初回ロード
  loadLangData(currentLang);

  // ===== 言語セレクト（存在する場合のみ） =====
  const langSelect = $("#langSelect");
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener("change", () => {
      const newLang = langSelect.value;
      currentLang = newLang;
      localStorage.setItem("dokodemodoors.lang", newLang);
      loadLangData(newLang);
    });
  }

  // ===== ページ入室時の自動動作 =====
  window.addEventListener("load", () => {
    fetchLobbyInfo();

    const autoJoinSaved = localStorage.getItem("voiceAutoJoin");
    if (autoJoinSaved === "1" && voicePowerBtn) {
      // ページロード後に少し待ってから joinVoice を呼び出す
      setTimeout(() => {
        joinVoice();
      }, 1000);
    }
  });

  // ===== スマホでの音声有効化ボタン =====
  const enableSoundBtn = $("#enableSound");
  if (enableSoundBtn) {
    enableSoundBtn.addEventListener("click", () => {
      const audio = $("#dummyAudio");
      if (audio) {
        audio.play().catch(() => {});
      }
    });
  }

  // ===== ボイスチャット用の PeerConnection ロジック（ダミー実装） =====
  // 実際の実装は Workers 側 / index.ts 側で用意されている前提で、
  // ここでは最低限のイベントハンドラだけ残しておく。

  // ===== WebRTC シグナリングの受信例（必要に応じて拡張） =====
  // handleServerEvent 内で type: "voiceSignal" などを見て処理することも可能。

  // ===== ボイス ON/OFF トグルでの注意書き =====
  updateVoiceUI();

  // ===== ここから下は、音声認識ボタンの UI ステータスなど =====
  (function setupVoiceRecordingUI() {
    const voiceRecordBtn = $("#voiceRecordBtn");
    const voiceRecordStatus = $("#voiceRecordStatus");

    if (!voiceRecordBtn || !voiceRecordStatus) return;

    let mediaRecorder = null;
    let chunks = [];
    let recording = false;

    function updateRecordUI() {
      voiceRecordBtn.textContent = recording
        ? t("lobby.voiceRecStop", "録音停止")
        : t("lobby.voiceRecStart", "録音開始（試作）");
      voiceRecordStatus.textContent = recording
        ? t("lobby.voiceRecRecording", "録音中…")
        : "";
    }

    voiceRecordBtn.addEventListener("click", async () => {
      if (!recording) {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
          mediaRecorder = new MediaRecorder(stream);
          mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) chunks.push(e.data);
          };
          mediaRecorder.onstop = () => {
            const blob = new Blob(chunks, { type: "audio/webm" });
            chunks = [];
            if (!blob || blob.size === 0) return;
            // ここで blob をどこかに送る（今は未実装）
          };
          mediaRecorder.start();
          recording = true;
          updateRecordUI();
        } catch (e) {
          console.error("voice record error", e);
        }
      } else {
        if (mediaRecorder) {
          mediaRecorder.stop();
        }
        recording = false;
        updateRecordUI();
      }
    });

    updateRecordUI();
  })();

  // ===== ページ最下部の接続ステータス表示 =====
  (function setupConnectionIndicator() {
    const indicator = $("#connectionIndicator");
    if (!indicator) return;

    function update() {
      const wsState = wsConnected
        ? t("lobby.connConnectedShort", "接続中")
        : t("lobby.connDisconnectedShort", "未接続");

      indicator.textContent = t("lobby.connIndicator", "{state}").replace(
        "{state}",
        wsState
      );
    }

    setInterval(update, 2000);
    update();
  })();

  // ===== ローカル用のデバッグショートカット（必要なら） =====
  (function setupDebugShortcuts() {
    try {
      window.__lobbyDebug = {
        readStore,
        writeStore,
        readOwners,
        writeOwners,
        autoDeleteRoom,
        fetchLobbyInfo,
        openWebSocket,
      };
    } catch (e) {}
  })();
})();
