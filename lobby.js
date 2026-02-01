// ===== 共通ヘルパー・定数 =====
const $ = (s) => document.querySelector(s);
const S = "meetups-store";
const O = "meetups-owners";
const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

// ★重要: 送信先
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

  let chatStatusMode = "initial";

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

    const voiceOnOffHint = $("#voiceOnOffHint");
    if (voiceOnOffHint) voiceOnOffHint.textContent = t("lobby.voiceOnOffNotice", "🔊 音声はON/OFFで改善することがあります。");
    const voiceSpeakHint = $("#voiceSpeakHint");
    if (voiceSpeakHint) voiceSpeakHint.textContent = t("lobby.voiceAskNotice", "🤵 ゆっくり・はっきり話すと認識が安定します。");

    const dateLabel = $("#dateLabel");
    if (dateLabel) dateLabel.textContent = t("lobby.dateLabel", (currentLang && currentLang.startsWith("ja") ? "開始日時" : "Start date & time"));
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
  const target = urlParams.get("target") || "";

  const titleEl = $("#title");
  if (titleEl) titleEl.textContent = title || t("lobby.noTitle", "タイトル未設定");
  const dateValue = $("#dateValue");
  if (dateValue && start) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) dateValue.textContent = d.toLocaleString(undefined, { timeZone: "Asia/Tokyo" });
  }

  // ===== カウントダウン =====
  function setupCountdown() {
    const countEl = $("#count");
    const statusEl = $("#status");
    if (!countEl || !statusEl || !start) return;
    const startDate = new Date(start);

    function update() {
      const now = new Date();
      const diff = startDate.getTime() - now.getTime();
      if (diff > 0) {
        const totalSec = Math.floor(diff / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        countEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
        statusEl.textContent = t("lobby.statusWaiting", "開始までお待ちください。");
        requestAnimationFrame(update);
        return;
      }
      const expireAt = new Date(startDate.getTime() + NEGATIVE_LIMIT_MS);
      const remainMs = expireAt - now;
      if (remainMs > 0) {
        const remainMin = Math.ceil(remainMs / 60000);
        countEl.textContent = t("lobby.statusDuring", "消滅まで後{minutes}分").replace("{minutes}", pad(remainMin));
        statusEl.textContent = t("lobby.statusOngoing", "ツアー中です。途中参加も可能です。");
        requestAnimationFrame(update);
        return;
      }
      countEl.textContent = t("lobby.statusExpired", "この待合室は終了しました");
      statusEl.textContent = t("lobby.statusExpiredDetail", "イベントは終了し、待合室は無効になっています。");
    }
    update();
  }
  setupCountdown();

  const enterBtn2 = $("#enterBtn");
  if (enterBtn2) {
    enterBtn2.addEventListener("click", () => {
      if (target) window.open(target, "_blank", "noopener,noreferrer");
    });
  }

  // ===== Chat Log ・リンク化 =====
  function linkify(text) {
    if (!text) return "";
    const urlRegex = /(https?:\/\/[a-zA-Z0-9.\-_/~%#?&=]+)/g;
    return text.replace(urlRegex, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
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

  function addMsg(kind, text) {
    const chatLog = $("#chatLog");
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function showThinking() {
    if ($(".thinking")) return;
    const div = document.createElement("div");
    div.className = "msg sys thinking";
    div.textContent = t("lobby.botThinking", "Reginald が考え中です…");
    $("#chatLog")?.appendChild(div);
    $("#chatLog").scrollTop = $("#chatLog").scrollHeight;
  }

  function hideThinking() {
    $(".thinking")?.remove();
  }

  // ===== WebSocket =====
  let user = (function () {
    try { return localStorage.getItem("nickname") || "Guest"; } catch (e) { return "Guest"; }
  })();

  const WS_BASE = "wss://do-chat.awachima7.workers.dev";
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(roomId)}?user=${encodeURIComponent(user)}`;
  let ws;
  let myId = null;
  let rosterMembers = [];

  function connect() {
    try {
      ws = new WebSocket(CHAT_URL);
      ws.onopen = () => { chatStatusMode = "connected"; applyLobbyTexts(); };
      ws.onclose = () => { chatStatusMode = "reconnecting"; applyLobbyTexts(); setTimeout(connect, 1500); };
      ws.onerror = () => { chatStatusMode = "error"; applyLobbyTexts(); };
      ws.onmessage = (ev) => {
        const data = JSON.parse(ev.data);
        if (data.type === "ping") { ws.send(JSON.stringify({ type: "pong" })); return; }
        if (data.rtc) { if (data.rtc.from !== myId) handleRTC(data.rtc.from, data.rtc); return; }
        if (data.sys) {
          if (data.type === "welcome") myId = data.id;
          if (data.type === "roster") { rosterMembers = data.members || []; renderMembers(rosterMembers); if (localStream) startCalls(rosterMembers); }
          if (data.type === "bot-thinking") showThinking();
          if (data.type === "bot-done") hideThinking();
          if (data.type === "history" && Array.isArray(data.messages)) {
            data.messages.forEach(line => {
              try {
                const obj = JSON.parse(line);
                addMsg(obj.name === user ? "me" : "other", `${obj.name}: ${normalizeChatText(obj.text)}`);
              } catch(e){}
            });
          }
          return;
        }
        if (data.text) { 
          if (data.name === "Reginald") hideThinking(); 
          addMsg(data.name === user ? "me" : "other", `${data.name}: ${normalizeChatText(data.text)}`); 
        }
      };
    } catch (e) {}
  }
  connect();

  function renderMembers(list) {
    const mEl = $("#members");
    if (!mEl) return;
    mEl.innerHTML = "";
    list.forEach((m, i) => {
      const row = document.createElement("div");
      row.className = "member";
      row.innerHTML = `<div class="badge">${i + 1}</div><div>${m.name || ""}</div>`;
      mEl.appendChild(row);
    });
  }

  // ===== WebRTC Voice (ボイスチャット用) =====
  let localStream = null;
  const peers = new Map();
  const remoteAudios = new Map();
  let voiceJoined = false;
  let micMuted = false;

  async function joinVoice() {
    if (voiceJoined) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceJoined = true; micMuted = false;
      updateVoiceUI();
      if (rosterMembers.length > 0) startCalls(rosterMembers);
    } catch (e) { alert(t("lobby.micErrorMsg", "マイクアクセス拒否")); }
  }

  function leaveVoice() {
    voiceJoined = false;
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    peers.forEach(pc => pc.close()); peers.clear();
    remoteAudios.forEach(a => a.remove()); remoteAudios.clear();
    updateVoiceUI();
  }

  function updateVoiceUI() {
    const vp = $("#voicePower");
    if (vp) vp.textContent = voiceJoined ? t("lobby.voiceOff", "音声OFF") : t("lobby.voiceOn", "音声ON");
    const mt = $("#micToggle");
    if (mt) { mt.style.display = voiceJoined ? "inline-block" : "none"; mt.textContent = micMuted ? t("lobby.mute", "ミュート") : t("lobby.unmute", "解除"); }
  }

  $("#voicePower")?.addEventListener("click", () => voiceJoined ? leaveVoice() : joinVoice());
  $("#micToggle")?.addEventListener("click", () => {
    if (!localStream) return;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !micMuted);
    updateVoiceUI();
  });

  function makePC(id) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pc.onicecandidate = (ev) => { if (ev.candidate && ws.readyState === 1) ws.send(JSON.stringify({ rtc: { type: "candidate", to: id, candidate: ev.candidate } })); };
    pc.ontrack = (ev) => {
      let a = remoteAudios.get(id);
      if (!a) { a = document.createElement("audio"); a.autoplay = true; remoteAudios.set(id, a); document.body.appendChild(a); }
      a.srcObject = ev.streams[0];
    };
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    peers.set(id, pc); return pc;
  }

  async function startCalls(mems) {
    if (!voiceJoined || !localStream) return;
    for (const m of mems) {
      if (m.id === myId || peers.has(m.id)) continue;
      const pc = makePC(m.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      ws.send(JSON.stringify({ rtc: { type: "offer", to: m.id, sdp: offer.sdp } }));
    }
  }

  async function handleRTC(from, rtc) {
    let pc = peers.get(from);
    if (rtc.type === "offer") {
      if (!pc) pc = makePC(from);
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp: rtc.sdp }));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ rtc: { type: "answer", to: from, sdp: answer.sdp } }));
    } else if (rtc.type === "answer" && pc) {
      await pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp: rtc.sdp }));
    } else if (rtc.type === "candidate" && pc) {
      await pc.addIceCandidate(new RTCIceCandidate(rtc.candidate)).catch(() => {});
    }
  }

  // ===== 執事に質問（音声）：Lucy方式・完全統合版 =====
  let voiceAskStream = null;
  let voiceAskRecorder = null;
  let voiceAskChunks = [];
  let voiceAskIsRecording = false;

  function stopAllVoiceAskTracks() {
    if (voiceAskStream) {
      try { voiceAskStream.getTracks().forEach(t => t.stop()); } catch (_) {}
    }
    voiceAskStream = null;
  }

  async function startRecording() {
    if (voiceAskIsRecording) return;
    voiceAskIsRecording = true;
    voiceAskChunks = [];
    const status = $("#voiceAskStatus");
    if (status) status.textContent = t("lobby.recording", "録音中...");

    try {
      // 1. 録音のたびに新しくマイクを取得 (Lucyと同じ)
      voiceAskStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceAskRecorder = new MediaRecorder(voiceAskStream);
      
      voiceAskRecorder.ondataavailable = (ev) => { if (ev.data && ev.data.size > 0) voiceAskChunks.push(ev.data); };

      voiceAskRecorder.onstop = async () => {
        const actualMimeType = voiceAskRecorder.mimeType || "audio/webm";
        const blob = new Blob(voiceAskChunks, { type: actualMimeType });
        voiceAskChunks = [];
        
        // 即座に解放
        stopAllVoiceAskTracks();
        voiceAskIsRecording = false;

        console.log("Recorded Blob:", blob.size, "bytes");

        // 0.4KBガード (Lucyの安定化ロジック反映)
        if (!blob || blob.size < 1000) {
          if (status) status.textContent = t("lobby.voiceAskNoSpeech", "音声不足");
          hideThinking();
          return;
        }

        if (status) status.textContent = t("lobby.sending", "音声を認識中...");
        showThinking();

        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          fd.append("lang", currentLang || "ja-JP");

          const res = await fetch(STT_URL, { method: "POST", body: fd });
          const data = await res.json();

          if (data.text) {
            if (ws && ws.readyState === 1) {
              ws.send(JSON.stringify({ type: "chat", text: data.text, name: user }));
              if (status) status.textContent = t("lobby.voiceAskSent", "送信完了");
            }
          } else {
            if (status) status.textContent = t("lobby.voiceAskNoSpeech", "未検出");
            hideThinking();
          }
        } catch (e) {
          if (status) status.textContent = t("lobby.voiceAskError", "エラー");
          hideThinking();
        }
      };

      // 100msごとにデータを収集して安定させる
      voiceAskRecorder.start(100);

    } catch (e) {
      if (status) status.textContent = t("lobby.micErrorMsg", "マイク拒否");
      voiceAskIsRecording = false;
    }
  }

  function stopRecording() {
    if (voiceAskIsRecording && voiceAskRecorder?.state !== "inactive") voiceAskRecorder.stop();
  }

  $("#voiceAskBtn")?.addEventListener("click", () => voiceAskIsRecording ? stopRecording() : startRecording());

  // 音響初期化
  (function initAudio() {
    const handler = () => {
      if (!window._audioContext) window._audioContext = new (window.AudioContext || window.webkitAudioContext)();
      if (window._audioContext.state === "suspended") window._audioContext.resume();
      window.removeEventListener("click", handler);
    };
    window.addEventListener("click", handler);
  })();

})();