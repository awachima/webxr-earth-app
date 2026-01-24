// ===== 共通ヘルパー・定数 =====
const $ = (s) => document.querySelector(s);
const S = "meetups-store";
const O = "meetups-owners";
const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

// ★重要: 送信先を新サーバー (do-stt) に変更
const STT_URL = "https://do-stt.awachima7.workers.dev";

const readStore = () => JSON.parse(localStorage.getItem(S) || "[]");
const writeStore = (arr) => localStorage.setItem(S, JSON.stringify(arr));
const readOwners = () => JSON.parse(localStorage.getItem(O) || "{}");
const writeOwners = (map) => localStorage.setItem(O, JSON.stringify(map));

function autoDeleteRoom(roomId) {
  if (!roomId) return;
  const remain = readStore().filter((x) => x.roomId !== roomId);
  writeStore(remain);
  const owners = readOwners();
  delete owners[roomId];
  writeOwners(owners);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

// ===== 言語推定 =====
function detectLang() {
  if (typeof navigator === "undefined") return "en";
  const navLang =
    navigator.languages && navigator.languages.length
      ? navigator.languages[0]
      : navigator.language || "en";
  if (!navLang) return "en";
  const lower = navLang.toLowerCase();
  if (lower.startsWith("ja")) return "ja-JP";
  if (lower.startsWith("en")) return "en";
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("fa")) return "fa";
  if (lower.startsWith("hi")) return "hi";
  if (lower.startsWith("he") || lower.startsWith("iw")) return "he";
  return "en";
}

(function () {
  const urlParams = new URLSearchParams(location.search);

  // ===== i18n 初期化 =====
  let currentLang = (function () {
    try {
      const urlLang = urlParams.get("lang");
      if (urlLang) {
        if (urlLang === "ja") return "ja-JP";
        if (urlLang === "iw") return "he";
        return urlLang;
      }
    } catch (e) {}
    try {
      const saved = localStorage.getItem("lang");
      if (saved) {
        if (saved === "ja") return "ja-JP";
        if (saved === "iw") return "he";
        return saved;
      }
    } catch (e) {}
    return detectLang();
  })();

  (function () {
    const root = document.documentElement;
    root.lang = currentLang || "en";
    if (currentLang === "fa" || currentLang === "he") {
      root.dir = "rtl";
    } else {
      root.dir = "ltr";
    }
  })();

  // ===== チャットステータス =====
  let chatStatusMode = "initial";

  // ===== i18n ヘルパー =====
  function t(path, fallback) {
    const root = window.i18n || {};
    const parts = path.split(".");
    let cur = root;
    for (const k of parts) {
      if (!cur || typeof cur !== "object" || !(k in cur)) return fallback;
      cur = cur[k];
    }
    return typeof cur === "string" ? cur : fallback;
  }

  function applyLobbyTexts() {
    const headerTitle = $("#lobbyHeaderTitle");
    if (headerTitle) headerTitle.textContent = t("lobby.headerTitle", "待ち合わせロビー");
    const setNameBtn = $("#setName");
    if (setNameBtn) setNameBtn.textContent = t("lobby.nicknameButton", "ニックネーム");
    const backBtn = $("#backToIndex");
    if (backBtn) backBtn.textContent = t("lobby.backButton", "← 戻る");
    const countdownLabel = $("#countdownLabel");
    if (countdownLabel) countdownLabel.textContent = t("lobby.countdownLabel", "カウントダウン");
    const voiceSectionTitle = $("#voiceSectionTitle");
    if (voiceSectionTitle) voiceSectionTitle.textContent = t("lobby.voiceSectionTitle", "ボイスチャット");
    const voiceControlLabel = $("#voiceControlLabel");
    if (voiceControlLabel) voiceControlLabel.textContent = t("lobby.voiceControlLabel", "ボイスチャット");
    const textChatLabel = $("#textChatLabel");
    if (textChatLabel) textChatLabel.textContent = t("lobby.textChatLabel", "テキストチャット");
    const copyRoomUrlBtn = $("#copyRoomUrl");
    if (copyRoomUrlBtn) copyRoomUrlBtn.textContent = t("lobby.copyRoomUrl", "この待合室のURLをコピー");
    const enableSound = $("#enableSound");
    if (enableSound) enableSound.textContent = t("lobby.enableSound", "スマホで音を有効化");

    const chatStatus = $("#chatStatus");
    if (chatStatus) {
      if (chatStatusMode === "initial") chatStatus.textContent = t("lobby.chatInitial", "接続していません");
      else if (chatStatusMode === "connected") chatStatus.textContent = t("lobby.chatConnected", "接続しました");
      else if (chatStatusMode === "reconnecting") chatStatus.textContent = t("lobby.chatReconnecting", "切断されました。再接続を試みます…");
      else if (chatStatusMode === "error") chatStatus.textContent = t("lobby.chatError", "エラーが発生しました");
    }

    const chatInput = $("#chatInput");
    if (chatInput) chatInput.placeholder = t("lobby.chatPlaceholder", "メッセージを入力…");
    const membersLabel = $("#membersLabel");
    if (membersLabel) membersLabel.textContent = t("lobby.membersLabel", "参加者");
    const voicePanelLabel = $("#voicePanelLabel");
    if (voicePanelLabel) voicePanelLabel.textContent = t("lobby.voicePanelLabel", "音声・会話設定");
    const micToggle = $("#micToggle");
    if (micToggle) micToggle.textContent = t("lobby.mute", "ミュート");
    const voicePower = $("#voicePower");
    if (voicePower) voicePower.textContent = t("lobby.voiceOn", "音声ON");
    const voiceAskBtn = $("#voiceAskBtn");
    if (voiceAskBtn) voiceAskBtn.textContent = t("lobby.voiceAskBtn", "執事に質問（音声）");

    const noticeSmalls = document.querySelectorAll(".notice-small");
    if (noticeSmalls[0]) noticeSmalls[0].textContent = t("lobby.voiceOnOffNotice", "🔊 音声はON/OFFで改善することがあります。");
    if (noticeSmalls[1]) noticeSmalls[1].textContent = t("lobby.voiceAskNotice", "🤵 ゆっくり・はっきり話すと認識が安定します。");

    const dateLabel = $("#dateLabel");
    if (dateLabel) dateLabel.textContent = t("lobby.dateLabel", (currentLang && currentLang.startsWith("ja") ? "開始日時" : "Start date & time"));
    const limitLabel = $("#limitLabel");
    if (limitLabel) limitLabel.textContent = t("lobby.limitLabel", "参加上限");
    const urlLabel = $("#urlLabel");
    if (urlLabel) urlLabel.textContent = t("lobby.urlLabel", "ツアーURL");
    const eventTypeLabel = $("#eventTypeLabel");
    if (eventTypeLabel) eventTypeLabel.textContent = t("lobby.eventTypeLabel", "種別");
    const priceLabel = $("#priceLabel");
    if (priceLabel) priceLabel.textContent = t("lobby.priceLabel", "参加費");
    const enterBtn = $("#enterBtn");
    if (enterBtn) enterBtn.textContent = t("lobby.enterButton", "ツアーに行く");
    const chatSend = $("#chatSend");
    if (chatSend) chatSend.textContent = t("lobby.chatSend", "送信");
    const lobbyFooter = $("#lobbyFooter");
    if (lobbyFooter) lobbyFooter.textContent = t("lobby.footer", "© DokodemoDoors");
  }

  async function loadLangData(lang) {
    let code = lang || "en";
    if (code === "ja") code = "ja-JP";
    if (code === "iw") code = "he";
    let url = "./lang/en.json";
    if (code.startsWith("ja")) url = "./lang/ja.json";
    else if (code.startsWith("zh")) url = "./lang/zh.json";
    else if (code === "fa") url = "./lang/fa.json";
    else if (code === "hi") url = "./lang/hi.json";
    else if (code === "he") url = "./lang/he.json";

    try {
      const res = await fetch(url, { cache: "no-cache" });
      if (!res.ok) throw new Error("lang load failed");
      const data = await res.json();
      window.i18n = data || {};
    } catch (e) {
      console.warn("lang load error", e);
      window.i18n = {};
    }
    applyLobbyTexts();
  }

  loadLangData(currentLang);

  const langSelect = $("#langSelect");
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener("change", (e) => {
      const value = e.target.value;
      currentLang = value;
      try { localStorage.setItem("lang", value); } catch (e2) {}
      if (value === "fa" || value === "he") document.documentElement.dir = "rtl";
      else document.documentElement.dir = "ltr";
      loadLangData(value);
    });
  }

  // ===== URL パラメータ =====
  const roomId = urlParams.get("roomId") || "default";
  const title = urlParams.get("title") || "";
  const start = urlParams.get("start") || "";
  const limit = urlParams.get("limit") || "";
  const target = urlParams.get("target") || "";
  const eventType = urlParams.get("eventType") || "";
  const price = urlParams.get("price") || "";

  const titleEl = $("#title");
  if (titleEl) titleEl.textContent = title || t("lobby.noTitle", "タイトル未設定");
  const metaEl = $("#meta");
  const dateValue = $("#dateValue");
  const limitValue = $("#limitValue");
  const urlValue = $("#urlValue");
  const eventTypeValue = $("#eventTypeValue");
  const priceValue = $("#priceValue");

  if (metaEl) {
    const label = t("lobby.startLabel", (currentLang && currentLang.startsWith("ja") ? "開始時刻：" : "Start time: "));
    if (start) {
      const d = new Date(start);
      if (!isNaN(d.getTime())) metaEl.textContent = label + d.toLocaleString(undefined, { timeZone: "Asia/Tokyo" });
      else metaEl.textContent = label + "—";
    } else metaEl.textContent = label + "—";
  }
  if (dateValue) {
    if (start) {
      const d = new Date(start);
      if (!isNaN(d.getTime())) dateValue.textContent = d.toLocaleString(undefined, { timeZone: "Asia/Tokyo" });
      else dateValue.textContent = t("lobby.dateUnknown", "未設定");
    } else dateValue.textContent = t("lobby.dateUnknown", "未設定");
  }
  if (limitValue) limitValue.textContent = limit ? t("lobby.participantLimit", "最大{limit}人").replace("{limit}", String(limit)) : t("lobby.limitUnknown", "未設定");
  if (urlValue) urlValue.textContent = target || "-";
  if (eventTypeValue) {
    if (eventType === "official") eventTypeValue.textContent = t("lobby.eventTypeOfficial", "公式イベント");
    else if (eventType === "fan") eventTypeValue.textContent = t("lobby.eventTypeFan", "ファン企画");
    else if (eventType === "private") eventTypeValue.textContent = t("lobby.eventTypePrivate", "非公開イベント");
    else if (eventType === "paid") eventTypeValue.textContent = t("lobby.eventTypePaid", "有料イベント");
    else eventTypeValue.textContent = t("lobby.eventTypeUnknown", "不明");
  }
  if (priceValue) priceValue.textContent = price || "-";

  // ===== カウントダウン =====
  function setupCountdown() {
    const countEl = $("#count");
    const statusEl = $("#status");
    if (!countEl || !statusEl) return;
    if (!start) {
      countEl.textContent = t("lobby.noStart", "未設定");
      statusEl.textContent = t("lobby.statusUnknown", "状態不明");
      return;
    }
    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) {
      countEl.textContent = t("lobby.invalidStart", "不正な日時");
      statusEl.textContent = t("lobby.statusUnknown", "状態不明");
      return;
    }

    function update() {
      const now = new Date();
      const diff = startDate.getTime() - now.getTime();
      if (diff > 0) {
        const totalSec = Math.floor(diff / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        $("#count").textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
        $("#status").textContent = t("lobby.statusWaiting", "開始までお待ちください。");
        requestAnimationFrame(update);
        return;
      }
      const expireAt = new Date(startDate.getTime() + NEGATIVE_LIMIT_MS);
      const remainMs = expireAt - now;
      if (remainMs > 0) {
        const remainMin = Math.ceil(remainMs / 60000);
        $("#count").textContent = t("lobby.statusDuring", "消滅まで後{minutes}分").replace("{minutes}", pad(remainMin));
        $("#status").textContent = t("lobby.statusOngoing", "ツアー中です。途中参加も可能です。");
        requestAnimationFrame(update);
        return;
      }
      $("#count").textContent = t("lobby.statusExpired", "この待合室は終了しました");
      $("#status").textContent = t("lobby.statusExpiredDetail", "イベントは終了し、待合室は無効になっています。");
    }
    update();
  }
  setupCountdown();

  const enterBtn2 = $("#enterBtn");
  if (enterBtn2) {
    enterBtn2.addEventListener("click", () => {
      if (!target) {
        alert(t("lobby.noTargetAlert", "ツアーURLが設定されていないため、移動できません。"));
        return;
      }
      window.open(target, "_blank", "noopener,noreferrer");
    });
  }

  // ===== ニックネーム =====
  let user = (function () {
    try {
      const stored = localStorage.getItem("nickname");
      if (stored) return stored;
    } catch (e) {}
    return "Guest";
  })();
  const setNameBtn2 = $("#setName");
  if (setNameBtn2) {
    setNameBtn2.addEventListener("click", () => {
      const newName = prompt(t("lobby.nicknamePrompt", "チャット用のニックネームを入力してください。"), user || "");
      if (!newName) return;
      user = newName.trim().slice(0, 32) || "Guest";
      try { localStorage.setItem("nickname", user); } catch (e2) {}
      alert(t("lobby.nicknameSaved", "ニックネームを保存しました。"));
    });
  }
  const backToIndex = $("#backToIndex");
  if (backToIndex) {
    backToIndex.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "./index.html";
    });
  }

  // ===== Members =====
  const membersEl = $("#members");
  function renderMembers(list) {
    membersEl.innerHTML = "";
    if (!list || list.length === 0) {
      const empty = document.createElement("div");
      empty.className = "status";
      empty.textContent = t("lobby.membersEmpty", "参加者はいません。");
      membersEl.appendChild(empty);
      return;
    }
    list.forEach((m, idx) => {
      const row = document.createElement("div");
      row.className = "member";
      const badge = document.createElement("div");
      badge.className = "badge";
      badge.textContent = String(idx + 1);
      const label = document.createElement("div");
      label.textContent = m.name || "";
      row.appendChild(badge);
      row.appendChild(label);
      membersEl.appendChild(row);
    });
  }

  // ===== Chat Log =====
  const chatLog = $("#chatLog");
  
  // ★修正: URLの末尾に ) などが含まれる場合に、それをリンクから除外する
  function linkify(text) {
    if (!text) return "";
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    return text.replace(urlRegex, (url) => {
        // 末尾が ) で、かつ中に ( が含まれていない場合は、) をリンクに含めない
        if (url.endsWith(")") && url.indexOf("(") === -1) {
            const cleanUrl = url.slice(0, -1);
            return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>)`;
        }
        return `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`;
    });
  }

  function normalizeChatText(rawText) {
    if (!rawText) return "";
    const trimmed = String(rawText).trim();
    if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
      try {
        const inner = JSON.parse(trimmed);
        if (inner && typeof inner.text === "string") return inner.text;
      } catch (e) {}
    }
    return rawText;
  }
  function addSys(text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg sys";
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function addMsg(kind, text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  const chatStatusEl = $("#chatStatus");
  const debugEl = $("#debug");
  function logDebug(msg) {
    if (!debugEl) return;
    const time = new Date().toISOString().slice(11, 19);
    debugEl.textContent += `[${time}] ${msg}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  // Reginald Thinking
  let thinkingElem = null;
  function showThinking(text) {
    if (!chatLog) return;
    if (thinkingElem) {
        thinkingElem.textContent = text || t("lobby.botThinking", "Reginald が考え中です…");
        return;
    }
    const div = document.createElement("div");
    div.className = "msg sys thinking";
    div.textContent = text || t("lobby.botThinking", "Reginald が考え中です…");
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    thinkingElem = div;
  }
  function hideThinking() {
    if (thinkingElem && thinkingElem.parentNode) thinkingElem.parentNode.removeChild(thinkingElem);
    thinkingElem = null;
  }

  // ===== WebSocket =====
  const WS_BASE = "wss://do-chat.awachima7.workers.dev";
  const pageParams = new URLSearchParams(location.search);
  pageParams.set("user", user);
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(roomId)}?${pageParams.toString()}`;

  let ws;
  let myId = null;
  let rosterMembers = [];

  function connect() {
    try {
      ws = new WebSocket(CHAT_URL);
      ws.onopen = () => {
        chatStatusMode = "connected";
        if (chatStatusEl) chatStatusEl.textContent = t("lobby.chatConnected", "接続しました");
        logDebug("WebSocket connected");
      };
      ws.onclose = () => {
        chatStatusMode = "reconnecting";
        if (chatStatusEl) chatStatusEl.textContent = t("lobby.chatReconnecting", "切断されました。再接続を試みます…");
        logDebug("WebSocket closed, retry in 1500ms");
        setTimeout(connect, 1500);
      };
      ws.onerror = (e) => {
        chatStatusMode = "error";
        if (chatStatusEl) chatStatusEl.textContent = t("lobby.chatError", "エラーが発生しました");
        logDebug("WebSocket error: " + (e?.message || ""));
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          // WebRTC Signaling
          if (data && data.rtc) {
            const rtc = data.rtc;
            const from = rtc.from;
            if (from && from !== myId) handleRTC(from, rtc);
            return;
          }
          // System Messages
          if (data.sys) {
            if (data.type === "welcome") {
              myId = data.id;
              logDebug("Welcome, myId = " + myId);
            } else if (data.type === "debug") {
              // ★サーバー側の失敗/途切れ情報を可視化
              try {
                const detail = data.detail ? JSON.stringify(data.detail) : "";
                logDebug("SERVER DEBUG: " + detail);
              } catch (e3) {
                logDebug("SERVER DEBUG (unserializable)");
              }
            } else if (data.type === "history" && Array.isArray(data.messages)) {
              data.messages.forEach((line) => {
                try {
                  const obj = JSON.parse(line);
                  if (obj.name === "Reginald") hideThinking();
                  const klass = obj.name === user ? "me" : "other";
                  const body = normalizeChatText(obj.text || "");
                  const text = t("lobby.chatLine", "{name}: {text}").replace("{name}", obj.name || "").replace("{text}", body);
                  addMsg(klass, text);
                } catch (e2) {}
              });
              addSys(t("lobby.historyLoaded", "— 過去のメッセージを読み込みました —"));
            } else if (data.type === "roster") {
              rosterMembers = Array.isArray(data.members) ? data.members : [];
              renderMembers(rosterMembers);
              if (localStream) startCalls(rosterMembers);
            } else if (data.type === "join") {
              const tpl = t("lobby.joined", "{name} が参加しました（合計 {count} 名）");
              addSys(tpl.replace("{name}", data.name || "").replace("{count}", String(data.count || 0)));
            } else if (data.type === "leave") {
              const tpl = t("lobby.left", "{name} が退出しました（合計 {count} 名）");
              addSys(tpl.replace("{name}", data.name || "").replace("{count}", String(data.count || 0)));
            } else if (data.type === "bot-thinking") {
              showThinking();
            } else if (data.type === "bot-done") {
              hideThinking();
            }
            return;
          }
          // Chat Messages
          const obj = data;
          if (obj.name === "Reginald") hideThinking();
          const klass = obj.name === user ? "me" : "other";
          const body = normalizeChatText(obj.text || "");
          const label = t("lobby.chatLine", "{name}: {text}").replace("{name}", obj.name || "").replace("{text}", body);
          addMsg(klass, label);
        } catch (e) {}
      };
    } catch (e) {
      chatStatusMode = "error";
      if (chatStatusEl) chatStatusEl.textContent = t("lobby.chatError", "エラーが発生しました");
      logDebug("WebSocket init error: " + (e?.message || ""));
    }
  }
  connect();

  const chatInput2 = $("#chatInput");
  const chatSend2 = $("#chatSend");
  if (chatSend2 && chatInput2) {
    chatSend2.addEventListener("click", () => {
      const text = chatInput2.value.trim();
      if (!text) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert(t("lobby.chatNotConnected", "チャットサーバーに接続されていません。しばらく待ってから再度お試しください。"));
        return;
      }
      ws.send(JSON.stringify({ type: "chat", text, name: user || "Guest" }));
      chatInput2.value = "";
    });
    chatInput2.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatSend2.click();
      }
    });
  }

  // ===== WebRTC Voice =====
  const voiceStatus = $("#voiceStatus");
  const voicePowerBtn = $("#voicePower");
  const micToggleBtn = $("#micToggle");
  const voiceHintEl = $("#voiceHint");
  let localStream = null;
  const peers = new Map();
  const remoteAudios = new Map();
  let voiceJoined = false;
  let micMuted = false;

  function updateVoiceUI() {
    if (voicePowerBtn) voicePowerBtn.textContent = voiceJoined ? t("lobby.voiceOff", "音声OFF") : t("lobby.voiceOn", "音声ON");
    if (micToggleBtn) {
      micToggleBtn.style.display = voiceJoined ? "inline-block" : "none";
      micToggleBtn.textContent = micMuted ? t("lobby.unmute", "ミュート解除") : t("lobby.mute", "ミュート");
    }
    if (voiceStatus) {
      if (!voiceJoined) voiceStatus.textContent = t("lobby.voiceNone", "音声: 未参加");
      else {
        const state = micMuted ? t("lobby.mute", "ミュート") : t("lobby.unmute", "ミュート解除");
        voiceStatus.textContent = t("lobby.voiceJoined", "音声: 参加中（マイク{state}）").replace("{state}", state);
      }
    }
    if (voiceHintEl) voiceHintEl.textContent = t("lobby.voiceHint", "※ 音声はブラウザ同士で直接やり取りされます。");
  }
  updateVoiceUI();

  async function joinVoice() {
    if (voiceJoined) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      alert(t("lobby.micErrorMsg", "マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。"));
      return;
    }
    voiceJoined = true;
    micMuted = false;
    updateVoiceUI();
    if (voiceStatus) voiceStatus.textContent = t("lobby.voiceJoining", "音声チャンネルに参加しています…");
    if (rosterMembers.length > 0) startCalls(rosterMembers);
  }
  function leaveVoice() {
    voiceJoined = false;
    micMuted = false;
    updateVoiceUI();
    if (localStream) {
      localStream.getTracks().forEach((t2) => t2.stop());
      localStream = null;
    }
    for (const pc of peers.values()) pc.close();
    peers.clear();
    for (const audio of remoteAudios.values()) audio.remove();
    remoteAudios.clear();
    if (voiceStatus) voiceStatus.textContent = t("lobby.voiceLeft", "音声チャンネルから退出しました。");
  }
  if (voicePowerBtn) voicePowerBtn.addEventListener("click", () => { if (!voiceJoined) joinVoice(); else leaveVoice(); });
  if (micToggleBtn) micToggleBtn.addEventListener("click", () => {
    if (!voiceJoined || !localStream) return;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach((track) => { track.enabled = !micMuted; });
    updateVoiceUI();
  });

  function makePC(id) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ rtc: { type: "candidate", to: id, candidate: ev.candidate } }));
    };
    pc.ontrack = (ev) => {
      let audio = remoteAudios.get(id);
      if (!audio) {
        audio = document.createElement("audio");
        audio.autoplay = true;
        remoteAudios.set(id, audio);
        document.body.appendChild(audio);
      }
      audio.srcObject = ev.streams[0];
    };
    if (localStream) localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    peers.set(id, pc);
    return pc;
  }
  async function startCalls(members) {
    if (!voiceJoined || !localStream) return;
    for (const m of members) {
      if (!m.id || m.id === myId) continue;
      if (peers.has(m.id)) continue;
      const pc = makePC(m.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ rtc: { type: "offer", to: m.id, sdp: offer.sdp } }));
    }
  }
  async function handleRTC(from, rtc) {
    const { type } = rtc;
    if (type === "offer") {
      let pc = peers.get(from);
      if (!pc) pc = makePC(from);
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: rtc.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ rtc: { type: "answer", to: from, sdp: answer.sdp } }));
    } else if (type === "answer") {
      const pc = peers.get(from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: rtc.sdp }));
    } else if (type === "candidate") {
      const pc = peers.get(from);
      if (pc && rtc.candidate) { try { await pc.addIceCandidate(new RTCIceCandidate(rtc.candidate)); } catch (e) {} }
    }
  }

  const enableSoundBtn = $("#enableSound");
  if (enableSoundBtn) {
    enableSoundBtn.addEventListener("click", () => {
      const ctx = window._audioContext;
      if (ctx && ctx.state === "suspended") {
        ctx.resume().then(() => { enableSoundBtn.textContent = t("lobby.enableSoundRetry", "音が出ない？もう一度有効化"); });
      } else enableSoundBtn.textContent = t("lobby.enableSoundRetry", "音が出ない？もう一度有効化");
    });
  }

  // ===== 執事に質問（音声） =====
  const voiceAskBtn2 = $("#voiceAskBtn");
  const voiceAskStatus = $("#voiceAskStatus");
  let mediaStream = null;
  let mediaRecorder = null;
  let chunks = [];
  let isRecording = false;

  function setVoiceAskStatus(key, fallback) {
    if (!voiceAskStatus) return;
    voiceAskStatus.textContent = t(`lobby.${key}`, fallback);
  }

  async function startRecording() {
    if (isRecording) return;
    isRecording = true;
    chunks = [];
    setVoiceAskStatus("recording", "録音中です。もう一度押すと停止します。");
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setVoiceAskStatus("micErrorMsg", "マイクへのアクセスが拒否されました。");
      isRecording = false;
      return;
    }

    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };

    // do-stt へ送信し、結果をWSで送るロジック
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      chunks = [];
      if (mediaStream) {
        mediaStream.getTracks().forEach((t2) => t2.stop());
        mediaStream = null;
      }
      if (!blob || blob.size === 0) {
        setVoiceAskStatus("micErrorMsg", "音声データが取得できませんでした。");
        return;
      }

      setVoiceAskStatus("sending", "音声を認識中…");
      showThinking(t("lobby.sttProcessing", "音声を文字に変換中…"));

      try {
        const formData = new FormData();
        formData.append("audio", blob, "voice.webm");

        const res = await fetch(STT_URL, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          throw new Error("STT API Error: " + res.status);
        }

        const data = await res.json();
        const recognizedText = data.text || "";

        if (recognizedText) {
          // 1. 即座に「自分の発言」として表示
          const line = t("lobby.chatLine", "{name}: {text}")
            .replace("{name}", user || "Guest")
            .replace("{text}", recognizedText);
          addMsg("me", line);

          // 2. チャットサーバに送信 (これでReginaldが反応する)
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({
              type: "chat",
              text: recognizedText,
              name: user || "Guest",
            }));
            showThinking(t("lobby.botThinking", "Reginald が考え中です…"));
            setVoiceAskStatus("voiceAskSent", "送信しました。");
          } else {
            setVoiceAskStatus("chatNotConnected", "チャットサーバー未接続のため送信できませんでした。");
            hideThinking();
          }
        } else {
          setVoiceAskStatus("voiceAskError", "音声が認識できませんでした。");
          hideThinking();
        }

      } catch (e) {
        console.error(e);
        hideThinking();
        setVoiceAskStatus("voiceAskError", "エラーが発生しました。");
      }
    };
    mediaRecorder.start();
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;
    if (mediaRecorder && mediaRecorder.state !== "inactive") mediaRecorder.stop();
  }

  if (voiceAskBtn2) {
    voiceAskBtn2.addEventListener("click", () => {
      if (!isRecording) startRecording();
      else stopRecording();
    });
  }

  (function initAudioContextOnce() {
    if (window._audioContext) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      window._audioContext = ctx;
      const resume = () => {
        if (ctx.state === "suspended") ctx.resume();
        window.removeEventListener("touchstart", resume);
        window.removeEventListener("click", resume);
      };
      window.addEventListener("touchstart", resume);
      window.addEventListener("click", resume);
    } catch (e) {}
  })();
})();