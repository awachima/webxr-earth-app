// lobby.js - 最終完全版（履歴復旧・エンドポイント正常化・排他制御統合）
(function () {
  // ===== 共通ヘルパー・定数 =====
  const $ = (s) => document.querySelector(s);
  const S = "meetups-store";
  const O = "meetups-owners";
  const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

  // 正しい STT エンドポイント
  const STT_URL = "https://do-stt.awachima7.workers.dev";

  const readStore = () => JSON.parse(localStorage.getItem(S) || "[]");
  const writeStore = (arr) => localStorage.setItem(S, JSON.stringify(arr));
  const readOwners = () => JSON.parse(localStorage.getItem(O) || "{}");
  const writeOwners = (map) => localStorage.setItem(O, JSON.stringify(map));

  function pad(n) { return String(n).padStart(2, "0"); }

  // ===== 言語推定 =====
  function detectLang() {
    if (typeof navigator === "undefined") return "en";
    const navLang = navigator.languages && navigator.languages.length ? navigator.languages[0] : navigator.language || "en";
    const lower = (navLang || "en").toLowerCase();
    if (lower.startsWith("ja")) return "ja-JP";
    if (lower.startsWith("en")) return "en";
    if (lower.startsWith("zh")) return "zh";
    if (lower.startsWith("fa")) return "fa";
    if (lower.startsWith("hi")) return "hi";
    if (lower.startsWith("he") || lower.startsWith("iw")) return "he";
    return "en";
  }

  const urlParams = new URLSearchParams(location.search);

  // ===== i18n 初期化 =====
  let currentLang = (function () {
    try {
      const urlLang = urlParams.get("lang");
      if (urlLang) return urlLang === "ja" ? "ja-JP" : (urlLang === "iw" ? "he" : urlLang);
      const saved = localStorage.getItem("lang");
      if (saved) return saved === "ja" ? "ja-JP" : (saved === "iw" ? "he" : saved);
    } catch (e) {}
    return detectLang();
  })();

  (function () {
    const root = document.documentElement;
    root.lang = currentLang || "en";
    root.dir = (currentLang === "fa" || currentLang === "he") ? "rtl" : "ltr";
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
    const ids = ["lobbyHeaderTitle", "setName", "backToIndex", "countdownLabel", "voiceSectionTitle", "voiceControlLabel", "textChatLabel", "copyRoomUrl", "enableSound", "micToggle", "voicePower", "voiceAskBtn", "voiceOnOffHint", "voiceSpeakHint", "dateLabel", "limitLabel", "urlLabel", "enterBtn", "chatSend"];
    ids.forEach(id => {
      const el = $(`#${id}`);
      if (el) el.textContent = t(`lobby.${id}`, el.textContent);
    });

    const chatStatus = $("#chatStatus");
    if (chatStatus) {
      if (chatStatusMode === "initial") chatStatus.textContent = t("lobby.chatInitial", "接続していません");
      else if (chatStatusMode === "connected") chatStatus.textContent = t("lobby.chatConnected", "接続しました");
      else if (chatStatusMode === "reconnecting") chatStatus.textContent = t("lobby.chatReconnecting", "再接続中…");
      else if (chatStatusMode === "error") chatStatus.textContent = t("lobby.chatError", "エラー");
    }
    if ($("#chatInput")) $("#chatInput").placeholder = t("lobby.chatPlaceholder", "メッセージを入力…");
  }

  async function loadLangData(lang) {
    let code = lang || "en";
    if (code === "ja") code = "ja-JP";
    if (code === "iw") code = "he";
    let url = `./lang/${code.startsWith("ja") ? "ja" : (code.startsWith("zh") ? "zh" : (code === "fa" ? "fa" : (code === "hi" ? "hi" : (code === "he" ? "he" : "en"))))}.json`;
    try {
      const res = await fetch(url, { cache: "no-cache" });
      window.i18n = res.ok ? await res.json() : {};
    } catch (e) { window.i18n = {}; }
    applyLobbyTexts();
  }

  loadLangData(currentLang);

  // ===== メタ情報 =====
  const roomId = urlParams.get("roomId") || "default";
  const title = urlParams.get("title") || "";
  const start = urlParams.get("start") || "";
  const target = urlParams.get("target") || "";

  $("#title") && ($("#title").textContent = title || t("lobby.noTitle", "タイトル未設定"));
  if (start) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) $("#dateValue") && ($("#dateValue").textContent = d.toLocaleString(undefined, { timeZone: "Asia/Tokyo" }));
  }

  // ===== カウントダウン =====
  function setupCountdown() {
    const countEl = $("#count"), statusEl = $("#status");
    if (!countEl || !statusEl || !start) return;
    const startDate = new Date(start);
    function update() {
      const now = new Date(), diff = startDate.getTime() - now.getTime();
      if (diff > 0) {
        const s = Math.floor(diff / 1000);
        countEl.textContent = `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
        statusEl.textContent = t("lobby.statusWaiting", "開始までお待ちください。");
        requestAnimationFrame(update);
      } else if (startDate.getTime() + NEGATIVE_LIMIT_MS - now.getTime() > 0) {
        countEl.textContent = "開催中";
        statusEl.textContent = t("lobby.statusOngoing", "ツアー中です。");
        requestAnimationFrame(update);
      } else {
        countEl.textContent = "終了しました";
      }
    }
    update();
  }
  setupCountdown();

  $("#enterBtn") && $("#enterBtn").addEventListener("click", () => {
    if (!target) return alert("URLがありません");
    window.open(target, "_blank", "noopener,noreferrer");
  });

  // ===== Chat & WebSocket =====
  let user = localStorage.getItem("nickname") || "Guest";
  const chatLog = $("#chatLog");
  function addMsg(kind, text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.innerHTML = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  let thinkingElem = null;
  function showThinking() {
    if (thinkingElem) return;
    thinkingElem = document.createElement("div");
    thinkingElem.className = "msg sys thinking";
    thinkingElem.textContent = "Reginald が考え中です…";
    chatLog.appendChild(thinkingElem);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function hideThinking() { if (thinkingElem) { thinkingElem.remove(); thinkingElem = null; } }

  const WS_BASE = "wss://do-chat.awachima7.workers.dev";
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(roomId)}?user=${encodeURIComponent(user)}`;
  let ws;
  let myId = null, rosterMembers = [];

  function connectWS() {
    ws = new WebSocket(CHAT_URL);
    ws.onopen = () => { chatStatusMode = "connected"; applyLobbyTexts(); };
    ws.onclose = () => { chatStatusMode = "reconnecting"; applyLobbyTexts(); setTimeout(connectWS, 2000); };
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
      if (data.rtc) return handleRTC(data.rtc.from, data.rtc);
      
      // ★履歴読み込み処理の復旧
      if (data.sys) {
        if (data.type === "welcome") myId = data.id;
        if (data.type === "history" && Array.isArray(data.messages)) {
          data.messages.forEach(mStr => {
            try {
              const m = JSON.parse(mStr);
              addMsg(m.name === user ? "me" : "other", `${m.name}: ${m.text}`);
            } catch(e) {}
          });
          addMsg("sys", "— 過去のメッセージを読み込みました —");
        }
        if (data.type === "roster") { 
          rosterMembers = data.members; 
          $("#members") && ($("#members").innerHTML = rosterMembers.map(m => `<div class="member"><div class="badge"></div>${m.name}</div>`).join(""));
          if (voiceJoined) startCalls(rosterMembers); 
        }
        if (data.type === "bot-thinking") showThinking();
        if (data.type === "bot-done") hideThinking();
      } else {
        hideThinking();
        addMsg(data.name === user ? "me" : "other", `${data.name}: ${data.text}`);
      }
    };
  }
  connectWS();

  $("#chatSend") && $("#chatSend").addEventListener("click", () => {
    const val = $("#chatInput").value.trim();
    if (val && ws.readyState === 1) { ws.send(JSON.stringify({ type: "chat", text: val, name: user })); $("#chatInput").value = ""; }
  });

  // ===== WebRTC (Voice Chat) =====
  let localStream = null, voiceJoined = false;
  const peers = new Map(), remoteAudios = new Map();

  function updateVoiceUI() {
    $("#voicePower") && ($("#voicePower").textContent = voiceJoined ? "音声OFF" : "音声ON");
  }

  async function joinVoice() {
    if (voiceJoined) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceJoined = true; updateVoiceUI();
      if (rosterMembers.length > 0) startCalls(rosterMembers);
    } catch (e) { alert("マイクが使えません"); }
  }

  function leaveVoice() {
    voiceJoined = false; updateVoiceUI();
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    peers.forEach(pc => pc.close()); peers.clear();
    remoteAudios.forEach(a => a.remove()); remoteAudios.clear();
  }

  $("#voicePower") && $("#voicePower").addEventListener("click", () => voiceJoined ? leaveVoice() : joinVoice());

  function makePC(id) {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pc.onicecandidate = (ev) => ev.candidate && ws.send(JSON.stringify({ rtc: { type: "candidate", to: id, candidate: ev.candidate } }));
    pc.ontrack = (ev) => {
      let a = remoteAudios.get(id) || document.createElement("audio");
      a.autoplay = true; a.srcObject = ev.streams[0];
      if (!remoteAudios.has(id)) { remoteAudios.set(id, a); document.body.appendChild(a); }
    };
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    peers.set(id, pc); return pc;
  }
  async function startCalls(mems) { mems.forEach(async m => { if (m.id !== myId && !peers.has(m.id)) { const pc = makePC(m.id); const offer = await pc.createOffer(); await pc.setLocalDescription(offer); ws.send(JSON.stringify({ rtc: { type: "offer", to: m.id, sdp: offer.sdp } })); } }); }
  async function handleRTC(from, rtc) {
    let pc = peers.get(from) || makePC(from);
    if (rtc.type === "offer") { await pc.setRemoteDescription(new RTCSessionDescription(rtc)); const ans = await pc.createAnswer(); await pc.setLocalDescription(ans); ws.send(JSON.stringify({ rtc: { type: "answer", to: from, sdp: ans.sdp } })); }
    else if (rtc.type === "answer") await pc.setRemoteDescription(new RTCSessionDescription(rtc));
    else if (rtc.type === "candidate") pc.addIceCandidate(new RTCIceCandidate(rtc.candidate));
  }

  // ===== 執事に質問（音声）=====
  let vRec = null, vChunks = [], vIsRec = false, vWasOn = false, vStream = null;

  async function startAsk() {
    if (vIsRec) return;
    vWasOn = voiceJoined;
    if (voiceJoined) leaveVoice();
    vIsRec = true; vChunks = [];
    $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "準備中...");
    try {
      await new Promise(r => setTimeout(r, 600));
      vStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vRec = new MediaRecorder(vStream);
      vRec.ondataavailable = (e) => { if (e.data.size > 0) vChunks.push(e.data); };
      vRec.onstop = async () => {
        const blob = new Blob(vChunks, { type: vRec.mimeType || "audio/webm" });
        if (vStream) { vStream.getTracks().forEach(t => t.stop()); vStream = null; }
        vIsRec = false;
        if (vWasOn) joinVoice();
        if (blob.size < 2000) { 
          $("#voiceAskStatus").textContent = "認識できませんでした (Size: " + blob.size + ")"; 
          return; 
        }
        $("#voiceAskStatus").textContent = "送信中...";
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          fd.append("lang", currentLang);
          const res = await fetch(STT_URL, { method: "POST", body: fd });
          const data = await res.json();
          if (data.text) ws.send(JSON.stringify({ type: "chat", text: data.text, name: user }));
          else $("#voiceAskStatus").textContent = "認識に失敗しました";
        } catch (e) { $("#voiceAskStatus").textContent = "通信エラー"; }
      };
      vRec.start(100);
      $("#voiceAskStatus").textContent = "録音中...";
    } catch (e) { vIsRec = false; if (vWasOn) joinVoice(); }
  }

  $("#voiceAskBtn") && $("#voiceAskBtn").addEventListener("click", () => vIsRec ? vRec.stop() : startAsk());
})();