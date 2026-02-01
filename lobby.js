(function () {
  const $ = (s) => document.querySelector(s);
  const S = "meetups-store";
  const O = "meetups-owners";
  const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

  // エンドポイント設定（do-chat WorkerのURL）
  const API_BASE = "https://do-chat.awachima7.workers.dev";
  const WS_BASE = "wss://do-chat.awachima7.workers.dev";

  const readStore = () => JSON.parse(localStorage.getItem(S) || "[]");
  const writeStore = (arr) => localStorage.setItem(S, JSON.stringify(arr));
  const readOwners = () => JSON.parse(localStorage.getItem(O) || "{}");
  const writeOwners = (map) => localStorage.setItem(O, JSON.stringify(map));

  function pad(n) { return String(n).padStart(2, "0"); }

  function detectLang() {
    if (typeof navigator === "undefined") return "ja-JP";
    const navLang = navigator.languages ? navigator.languages[0] : (navigator.language || "ja-JP");
    return navLang.toLowerCase().startsWith("ja") ? "ja-JP" : "en";
  }

  const urlParams = new URLSearchParams(location.search);

  // ===== i18n 初期化 =====
  let currentLang = (function () {
    try {
      const urlLang = urlParams.get("lang");
      if (urlLang) return urlLang === "ja" ? "ja-JP" : urlLang;
      const saved = localStorage.getItem("lang");
      if (saved) return saved === "ja" ? "ja-JP" : saved;
    } catch (e) {}
    return detectLang();
  })();

  (function () {
    const root = document.documentElement;
    root.lang = currentLang || "ja-JP";
    root.dir = (currentLang === "fa" || currentLang === "he") ? "rtl" : "ltr";
  })();

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
  }

  async function loadLangData(lang) {
    let code = lang.startsWith("ja") ? "ja" : "en";
    try {
      const res = await fetch(`./lang/${code}.json`, { cache: "no-cache" });
      window.i18n = res.ok ? await res.json() : {};
    } catch (e) { window.i18n = {}; }
    applyLobbyTexts();
  }
  loadLangData(currentLang);

  // ===== ルームメタ情報 =====
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

  // ===== チャット表示正規化 (JSON混入防止修正) =====
  function normalizeChatText(rawText) {
    if (!rawText) return "";
    const trimmed = String(rawText).trim();
    // {"type":"chat","text":"..."} 形式が来たら text だけ取り出す
    if (trimmed.startsWith("{") && trimmed.includes('"text":')) {
      try {
        const inner = JSON.parse(trimmed);
        if (inner && typeof inner.text === "string") return inner.text;
      } catch (e) {}
    }
    return rawText;
  }

  const chatLog = $("#chatLog");
  function addMsg(kind, text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg " + kind;
    const body = normalizeChatText(text); // ここでJSONをクリーンにする
    div.innerHTML = body.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
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

  // ===== WebSocket 接続 =====
  let user = localStorage.getItem("nickname") || "Guest";
  // クエリパラメータを維持
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(roomId)}?user=${encodeURIComponent(user)}&title=${encodeURIComponent(title)}&start=${encodeURIComponent(start)}&target=${encodeURIComponent(target)}`;
  let ws;
  let myId = null, rosterMembers = [];

  function connectWS() {
    ws = new WebSocket(CHAT_URL);
    ws.onopen = () => { console.log("WS Connected"); };
    ws.onclose = () => { setTimeout(connectWS, 2000); };
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
      if (data.rtc) return handleRTC(data.rtc.from, data.rtc);
      
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

  const sendText = () => {
    const val = $("#chatInput").value.trim();
    if (val && ws.readyState === 1) { 
      // 元の通信形式を維持
      ws.send(JSON.stringify({ type: "chat", text: val, name: user })); 
      $("#chatInput").value = ""; 
    }
  };

  $("#chatSend") && $("#chatSend").addEventListener("click", sendText);
  $("#chatInput") && $("#chatInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendText();
  });

  // ===== WebRTC (既存機能維持) =====
  let localStream = null, voiceJoined = false;
  const peers = new Map(), remoteAudios = new Map();

  async function joinVoice() {
    if (voiceJoined) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceJoined = true;
      $("#voicePower") && ($("#voicePower").textContent = "音声OFF");
      $("#micToggle") && ($("#micToggle").style.display = "inline-block");
      if (rosterMembers.length > 0) startCalls(rosterMembers);
    } catch (e) { alert("マイクへのアクセスが拒否されました。"); }
  }

  function leaveVoice() {
    voiceJoined = false;
    $("#voicePower") && ($("#voicePower").textContent = "音声ON");
    $("#micToggle") && ($("#micToggle").style.display = "none");
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

  // ===== 音声入力 (修正) =====
  let vRec = null, vIsRec = false, vWasOn = false, vStream = null;
  async function startAsk() {
    if (vIsRec) return;
    vWasOn = voiceJoined;
    if (voiceJoined) leaveVoice(); 
    vIsRec = true;
    let chunks = [];
    $("#voiceAskStatus").textContent = "準備中...";
    try {
      await new Promise(r => setTimeout(r, 600)); 
      vStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vRec = new MediaRecorder(vStream);
      vRec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      vRec.onstop = async () => {
        const blob = new Blob(chunks, { type: "audio/webm" });
        vStream.getTracks().forEach(t => t.stop());
        vIsRec = false;
        if (vWasOn) joinVoice(); 
        if (blob.size < 2000) { $("#voiceAskStatus").textContent = "音声が短すぎます"; return; }
        $("#voiceAskStatus").textContent = "解析中...";
        try {
          const fd = new FormData();
          fd.append("audio", blob, "voice.webm");
          // API_BASE/voice へ送信
          const res = await fetch(`${API_BASE}/voice?lang=${currentLang}`, { method: "POST", body: fd });
          const data = await res.json();
          if (data.ok) { $("#voiceAskStatus").textContent = "認識しました"; } 
          else { $("#voiceAskStatus").textContent = "認識に失敗しました"; }
        } catch (e) { $("#voiceAskStatus").textContent = "エラー"; }
      };
      vRec.start(100);
      $("#voiceAskStatus").textContent = "録音中...";
    } catch (e) { vIsRec = false; if (vWasOn) joinVoice(); }
  }
  $("#voiceAskBtn") && $("#voiceAskBtn").addEventListener("click", () => vIsRec ? vRec.stop() : startAsk());

  // URLコピー機能
  $("#copyRoomUrl") && $("#copyRoomUrl").addEventListener("click", () => {
    navigator.clipboard.writeText(location.href).then(() => alert("URLをコピーしました"));
  });

})();