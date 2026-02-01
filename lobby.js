// lobby.js - 最終完全版: 全機能統合・マイク物理排他制御・エンドポイント正常化
(function () {
  // ===== 共通ヘルパー・定数 =====
  const $ = (s) => document.querySelector(s);
  const S = "meetups-store";
  const O = "meetups-owners";
  const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

  // 送信先を今回のプロジェクト用の STT サーバーに固定
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
    $("#lobbyHeaderTitle") && ($("#lobbyHeaderTitle").textContent = t("lobby.headerTitle", "待ち合わせロビー"));
    $("#setName") && ($("#setName").textContent = t("lobby.nicknameButton", "ニックネーム"));
    $("#backToIndex") && ($("#backToIndex").textContent = t("lobby.backButton", "← 戻る"));
    $("#countdownLabel") && ($("#countdownLabel").textContent = t("lobby.countdownLabel", "カウントダウン"));
    $("#voiceSectionTitle") && ($("#voiceSectionTitle").textContent = t("lobby.voiceSectionTitle", "ボイスチャット"));
    $("#voiceControlLabel") && ($("#voiceControlLabel").textContent = t("lobby.voiceControlLabel", "ボイスチャット"));
    $("#textChatLabel") && ($("#textChatLabel").textContent = t("lobby.textChatLabel", "テキストチャット"));
    $("#copyRoomUrl") && ($("#copyRoomUrl").textContent = t("lobby.copyRoomUrl", "この待合室のURLをコピー"));
    $("#enableSound") && ($("#enableSound").textContent = t("lobby.enableSound", "スマホで音を有効化"));

    const chatStatus = $("#chatStatus");
    if (chatStatus) {
      if (chatStatusMode === "initial") chatStatus.textContent = t("lobby.chatInitial", "接続していません");
      else if (chatStatusMode === "connected") chatStatus.textContent = t("lobby.chatConnected", "接続しました");
      else if (chatStatusMode === "reconnecting") chatStatus.textContent = t("lobby.chatReconnecting", "切断されました。再接続を試みます…");
      else if (chatStatusMode === "error") chatStatus.textContent = t("lobby.chatError", "エラーが発生しました");
    }

    $("#chatInput") && ($("#chatInput").placeholder = t("lobby.chatPlaceholder", "メッセージを入力…"));
    $("#membersLabel") && ($("#membersLabel").textContent = t("lobby.membersLabel", "参加者"));
    $("#voicePanelLabel") && ($("#voicePanelLabel").textContent = t("lobby.voicePanelLabel", "音声・会話設定"));
    $("#micToggle") && ($("#micToggle").textContent = t("lobby.mute", "ミュート"));
    $("#voicePower") && ($("#voicePower").textContent = t("lobby.voiceOn", "音声ON"));
    $("#voiceAskBtn") && ($("#voiceAskBtn").textContent = t("lobby.voiceAskBtn", "執事に質問（音声）"));
    $("#voiceOnOffHint") && ($("#voiceOnOffHint").textContent = t("lobby.voiceOnOffNotice", "🔊 音声はON/OFFで改善することがあります。"));
    $("#voiceSpeakHint") && ($("#voiceSpeakHint").textContent = t("lobby.voiceAskNotice", "🤵 ゆっくり・はっきり話すと認識が安定します。"));
    $("#dateLabel") && ($("#dateLabel").textContent = t("lobby.dateLabel", "開始日時"));
    $("#limitLabel") && ($("#limitLabel").textContent = t("lobby.limitLabel", "参加上限"));
    $("#urlLabel") && ($("#urlLabel").textContent = t("lobby.urlLabel", "ツアーURL"));
    $("#enterBtn") && ($("#enterBtn").textContent = t("lobby.enterButton", "ツアーに行く"));
    $("#chatSend") && ($("#chatSend").textContent = t("lobby.chatSend", "送信"));
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

  const langSelect = $("#langSelect");
  if (langSelect) {
    langSelect.value = currentLang;
    langSelect.addEventListener("change", (e) => {
      currentLang = e.target.value;
      localStorage.setItem("lang", currentLang);
      document.documentElement.dir = (currentLang === "fa" || currentLang === "he") ? "rtl" : "ltr";
      loadLangData(currentLang);
    });
  }

  // ===== URL パラメータ・メタ情報 =====
  const roomId = urlParams.get("roomId") || "default";
  const title = urlParams.get("title") || "";
  const start = urlParams.get("start") || "";
  const target = urlParams.get("target") || "";
  const limit = urlParams.get("limit") || "";
  const price = urlParams.get("price") || "";

  $("#title") && ($("#title").textContent = title || t("lobby.noTitle", "タイトル未設定"));
  if (start) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) $("#dateValue") && ($("#dateValue").textContent = d.toLocaleString(undefined, { timeZone: "Asia/Tokyo" }));
  }
  $("#limitValue") && ($("#limitValue").textContent = limit || "-");
  $("#urlValue") && ($("#urlValue").textContent = target || "-");
  $("#priceValue") && ($("#priceValue").textContent = price || "-");

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
    if (!target) return alert(t("lobby.noTargetAlert", "URLがありません"));
    window.open(target, "_blank", "noopener,noreferrer");
  });

  // ===== ニックネーム =====
  let user = localStorage.getItem("nickname") || "Guest";
  $("#setName") && $("#setName").addEventListener("click", () => {
    const n = prompt(t("lobby.nicknamePrompt", "ニックネーム"), user);
    if (n) { user = n.trim().slice(0, 32); localStorage.setItem("nickname", user); }
  });

  $("#backToIndex") && $("#backToIndex").addEventListener("click", () => location.href = "./index.html");

  // ===== Chat & UI =====
  const chatLog = $("#chatLog"), debugEl = $("#debug");
  function logDebug(msg) {
    if (!debugEl) return;
    debugEl.textContent += `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  function addMsg(kind, text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.innerHTML = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>');
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  let thinkingElem = null;
  function showThinking(text) {
    if (thinkingElem) { thinkingElem.textContent = text; return; }
    thinkingElem = document.createElement("div");
    thinkingElem.className = "msg sys thinking";
    thinkingElem.textContent = text || t("lobby.botThinking", "Reginald が考え中です…");
    chatLog.appendChild(thinkingElem);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function hideThinking() { if (thinkingElem) { thinkingElem.remove(); thinkingElem = null; } }

  // ===== WebSocket =====
  const WS_BASE = "wss://do-chat.awachima7.workers.dev";
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(roomId)}?user=${encodeURIComponent(user)}`;
  let ws;
  let myId = null, rosterMembers = [];

  function connectWS() {
    ws = new WebSocket(CHAT_URL);
    ws.onopen = () => { chatStatusMode = "connected"; applyLobbyTexts(); logDebug("WS Connected"); };
    ws.onclose = () => { chatStatusMode = "reconnecting"; applyLobbyTexts(); setTimeout(connectWS, 2000); };
    ws.onmessage = (ev) => {
      const data = JSON.parse(ev.data);
      if (data.type === "ping") return ws.send(JSON.stringify({ type: "pong" }));
      if (data.rtc) return handleRTC(data.rtc.from, data.rtc);
      if (data.sys) {
        if (data.type === "welcome") myId = data.id;
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
  let localStream = null, voiceJoined = false, micMuted = false;
  const peers = new Map(), remoteAudios = new Map();

  function updateVoiceUI() {
    $("#voicePower") && ($("#voicePower").textContent = voiceJoined ? t("lobby.voiceOff", "音声OFF") : t("lobby.voiceOn", "音声ON"));
    $("#micToggle") && ($("#micToggle").style.display = voiceJoined ? "inline-block" : "none");
  }

  async function joinVoice() {
    if (voiceJoined) return;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceJoined = true; updateVoiceUI();
      if (rosterMembers.length > 0) startCalls(rosterMembers);
    } catch (e) { alert("マイクへのアクセスが拒否されました。"); }
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

  async function startCalls(mems) { 
    mems.forEach(async m => { 
        if (m.id !== myId && !peers.has(m.id)) { 
            const pc = makePC(m.id); 
            const offer = await pc.createOffer(); 
            await pc.setLocalDescription(offer); 
            ws.send(JSON.stringify({ rtc: { type: "offer", to: m.id, sdp: offer.sdp } })); 
        } 
    }); 
  }

  async function handleRTC(from, rtc) {
    let pc = peers.get(from) || makePC(from);
    if (rtc.type === "offer") { 
        await pc.setRemoteDescription(new RTCSessionDescription(rtc)); 
        const ans = await pc.createAnswer(); 
        await pc.setLocalDescription(ans); 
        ws.send(JSON.stringify({ rtc: { type: "answer", to: from, sdp: ans.sdp } })); 
    }
    else if (rtc.type === "answer") { await pc.setRemoteDescription(new RTCSessionDescription(rtc)); }
    else if (rtc.type === "candidate") { try { await pc.addIceCandidate(new RTCIceCandidate(rtc.candidate)); } catch (e) {} }
  }

  // ===== 執事に質問（音声）: 物理排他制御 & 正常エンドポイント統合 =====
  let vRec = null, vChunks = [], vIsRec = false, vWasOn = false, vStream = null;

  async function startAsk() {
    if (vIsRec) return;
    vWasOn = voiceJoined;
    // 録音開始前にボイスチャット用マイクを物理的に止める
    if (voiceJoined) { logDebug("Shutting down WebRTC for recording exclusivity."); leaveVoice(); }
    
    vIsRec = true; vChunks = [];
    $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "準備中...");

    try {
      await new Promise(r => setTimeout(r, 600)); // デバイスの物理的解放を待機
      vStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      vRec = new MediaRecorder(vStream);
      vRec.ondataavailable = (e) => { if (e.data.size > 0) vChunks.push(e.data); };
      
      vRec.onstop = async () => {
        const actualMimeType = vRec.mimeType || "audio/webm";
        const blob = new Blob(vChunks, { type: actualMimeType });
        console.log("Recorded Blob Created:", blob.size, "bytes");
        
        // 録音用ストリームの全トラックを物理的に止める
        if (vStream) { vStream.getTracks().forEach(t => t.stop()); vStream = null; }
        vIsRec = false;

        // ボイスチャットが元々ONだった場合は再接続して復帰させる
        if (vWasOn) { logDebug("Restarting WebRTC voice."); joinVoice(); }

        // 無音ガード: 2000バイト(2KB)未満は無視する
        if (blob.size < 2000) { 
            $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "音声が検出されませんでした。"); 
            hideThinking();
            return; 
        }

        $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "送信中...");
        showThinking("音声を文字に変換中...");

        try {
          const fd = new FormData(); 
          fd.append("audio", blob, "voice.webm"); 
          fd.append("lang", currentLang);

          // エンドポイントを STT サーバーに固定 (lucy-recommend を排除)
          const res = await fetch(STT_URL, { method: "POST", body: fd });
          if (!res.ok) throw new Error("STT Error: " + res.status);

          const data = await res.json();
          if (data.text && ws && ws.readyState === 1) {
            ws.send(JSON.stringify({ type: "chat", text: data.text, name: user }));
            $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "送信しました。");
          } else {
            $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "認識できませんでした。");
          }
        } catch (e) { 
            console.error(e);
            $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "通信エラーが発生しました。"); 
        } finally { hideThinking(); }
      };

      vRec.start(100);
      $("#voiceAskStatus") && ($("#voiceAskStatus").textContent = "録音中... (もう一度押すと停止)");
    } catch (e) { 
        logDebug("Mic error during STT: " + e.message);
        vIsRec = false; 
        if (vWasOn) joinVoice(); 
    }
  }

  $("#voiceAskBtn") && $("#voiceAskBtn").addEventListener("click", () => vIsRec ? vRec.stop() : startAsk());

  // 音声コンテキスト初期化
  window.addEventListener("click", () => {
    if (window._audioContext && window._audioContext.state === "suspended") window._audioContext.resume();
  }, { once: true });

})();