// ===== 共通ヘルパー・定数 =====
const $  = (s) => document.querySelector(s);
const S  = "meetups-store";
const O  = "meetups-owners";
const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

const readStore  = () => JSON.parse(localStorage.getItem(S) || "[]");
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
  console.info("[auto-delete - lobby]", roomId, "を削除しました");
}

const urlParams = new URLSearchParams(location.search);

// ===== 言語判定 & html 属性設定 =====
const langParam  = urlParams.get("lang");
const storedLang = localStorage.getItem("lang");
let currentLang  = langParam || storedLang || "en";

window.currentLang = currentLang;
try {
  localStorage.setItem("lang", currentLang);
} catch (e) {}

document.documentElement.lang = currentLang;
if (currentLang === "fa" || currentLang === "he") {
  document.documentElement.dir = "rtl";
} else {
  document.documentElement.dir = "ltr";
}

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

  const copyBtn = $("#copy");
  if (copyBtn) copyBtn.textContent = t("lobby.copyRoomUrl", "この待合室のURLをコピー");

  const enterBtn = $("#enter");
  if (enterBtn) enterBtn.textContent = t("lobby.enterButton", "ツアーに行く");

  const chatSend = $("#chatSend");
  if (chatSend) chatSend.textContent = t("lobby.chatSend", "送信");

  const chatInput = $("#chatInput");
  if (chatInput) chatInput.placeholder = t("lobby.chatPlaceholder", "メッセージを入力…");

  const enableSound = $("#enableSound");
  if (enableSound) enableSound.textContent = t("lobby.enableSound", "スマホで音を有効化");

  const footer = $("#lobbyFooter");
  if (footer) footer.textContent = t("lobby.footer", "© DokodemoDoors");

  const voiceAskBtn = $("#voiceAskBtn");
  if (voiceAskBtn) {
    voiceAskBtn.textContent = t(
      "lobby.voiceAskButton",
      "執事に質問（音声）"
    );
  }
}

async function loadLobbyLanguage(lang) {
  let data = {};
  try {
    const res = await fetch("./lang/" + lang + ".json");
    if (!res.ok) throw new Error("Failed to load language: " + lang);
    data = await res.json();
  } catch (e) {
    console.error("[lobby i18n]", e);
    data = window.i18n || {};
  }
  window.i18n = data || {};
  window.currentLang = lang;
  try {
    localStorage.setItem("lang", lang);
  } catch (e) {}
  applyLobbyTexts();
}

// ===== URL 自動リンク化 =====
function linkify(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => {
    const safeUrl = url.replace(/"/g, "&quot;");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
  });
}

// ===== メイン初期化（i18n 読み込み後に実行） =====
(async function initLobby() {
  await loadLobbyLanguage(currentLang);

  const titleParam  = urlParams.get("title") || "待ち合わせ";
  const startParam  = urlParams.get("start");
  const limitParam  = parseInt(urlParams.get("limit") || "10", 10);
  const targetParam = urlParams.get("target") || "";
  const roomId      = urlParams.get("roomId") || "";

  const storeItem   = roomId ? readStore().find((x) => x.roomId === roomId) : null;
  const eventTypeParam = urlParams.get("eventType");
  const priceParam     = parseInt(urlParams.get("price") || "0", 10);

  let eventType = eventTypeParam || (storeItem && storeItem.eventType) || "free";
  let price     = Number.isFinite(priceParam)
    ? priceParam
    : (storeItem && storeItem.price) || 0;

  eventType = eventType === "paid" ? "paid" : "free";
  price = price || 0;

  const storedNick  = localStorage.getItem("nickname");
  const user        = storedNick || `Guest-${Math.random().toString(16).slice(2, 6)}`;
  const isMobile    = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isIOS       = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  $("#title").textContent = titleParam;
  document.title = titleParam + " | " + t("lobby.pageTitleSuffix", "待ち合わせロビー");

  let startDate = null;
  const metaEl = $("#meta");

  let eventLabel = "";
  if (eventType === "paid") {
    if (price > 0) {
      const base = t("lobby.eventPaidWithPrice", "Paid event ({price} JPY)");
      eventLabel = base.replace("{price}", String(price));
    } else {
      eventLabel = t("lobby.eventPaid", "Paid event");
    }
  } else {
    eventLabel = t("lobby.eventFree", "Free event");
  }

  if (startParam) {
    startDate = new Date(startParam);
    const baseText = t("lobby.startLabel", "開始時刻：") + startDate.toLocaleString();

    if (metaEl) {
      metaEl.textContent = baseText;
      const span = document.createElement("span");
      span.style.marginLeft = "1.5rem";
      span.textContent = eventLabel;
      metaEl.appendChild(span);
    }
  } else {
    if (metaEl) {
      metaEl.textContent = t("lobby.startLabel", "開始時刻：") + "—";
      const span = document.createElement("span");
      span.style.marginLeft = "1.5rem";
      span.textContent = eventLabel;
      metaEl.appendChild(span);
    }
  }

  if (Number.isFinite(limitParam) && limitParam > 0) {
    const pill = document.createElement("div");
    pill.className = "pill";
    const tpl = t("lobby.participantLimit", "参加上限 {limit} 名");
    pill.textContent = tpl.replace("{limit}", String(limitParam));
    pill.style.display = "inline-flex";
    $("#limitPill").replaceWith(pill);
  }

  const enterBtn = $("#enter");
  const validTarget = /^https?:\/\//i.test(targetParam);
  if (validTarget) {
    enterBtn.href = targetParam;
  } else {
    enterBtn.style.display = "none";
  }

  const pad = (n) => String(n).padStart(2, "0");

  function tick() {
    if (!startDate) {
      $("#count").textContent = "--:--:--";
      $("#status").innerHTML =
        `<span style="color:#b00020">${t("lobby.statusNoStart", "開始時刻未設定")}</span>`;
      requestAnimationFrame(tick);
      return;
    }
    const now = new Date();
    const diff = startDate - now;

    if (diff > 0) {
      const h = Math.floor(diff / 3600000);
      const m = Math.floor(diff / 60000) % 60;
      const s = Math.floor(diff / 1000) % 60;
      $("#count").textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
      $("#status").textContent = t("lobby.statusWaiting", "開始までお待ちください。");
      requestAnimationFrame(tick);
      return;
    }

    const expireAt = new Date(startDate.getTime() + NEGATIVE_LIMIT_MS);
    const remainMs = expireAt - now;
    if (remainMs > 0) {
      const remainMin = Math.ceil(remainMs / 60000);
      const label = t("lobby.statusDuring", "消滅まで後{minutes}分").replace(
        "{minutes}",
        pad(remainMin)
      );
      $("#count").textContent = label;
      $("#status").textContent = t(
        "lobby.statusStarted",
        "開始済み：入室できます（20分以内）"
      );
      requestAnimationFrame(tick);
    } else {
      autoDeleteRoom(roomId);
      $("#count").textContent = t("lobby.statusExpiredShort", "消滅しました");
      $("#status").innerHTML = `<span style="color:#b00020">${t(
        "lobby.statusEnded",
        "この待ち合わせは終了しました"
      )}</span>`;
    }
  }
  requestAnimationFrame(tick);

  $("#copy").onclick = async () => {
    const url = location.href;
    try {
      await navigator.clipboard.writeText(url);
      const labelCopied = t("lobby.copied", "コピーしました");
      const labelDefault = t("lobby.copyRoomUrl", "この待合室のURLをコピー");
      $("#copy").textContent = labelCopied;
      setTimeout(() => ($("#copy").textContent = labelDefault), 1200);
    } catch (e) {
      const msg = t("lobby.manualCopyPrompt", "手動コピー：");
      prompt(msg, url);
    }
  };

  $("#debug").textContent = JSON.stringify(
    {
      title: titleParam,
      start: startParam,
      limit: limitParam,
      target: targetParam,
      roomId,
      user,
      isMobile,
      isIOS,
      lang: currentLang,
      eventType,
      price
    },
    null,
    2
  );

  $("#setName").onclick = function setNickname() {
    const current = localStorage.getItem("nickname") || user;
    const promptLabel = t(
      "lobby.nicknamePrompt",
      "ニックネームを入力してください："
    );
    const savedMsg = t(
      "lobby.nicknameSaved",
      "ニックネームを保存しました。ページを再読み込みすると反映されます。"
    );

    const name = prompt(promptLabel, current);
    if (!name) return;
    localStorage.setItem("nickname", name.trim().slice(0, 32));
    alert(savedMsg);
  };

  const WS_BASE = "wss://do-chat.awachima7.workers.dev";
  const pageParams = new URLSearchParams(location.search);
  pageParams.set("user", user);
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(roomId)}?${pageParams.toString()}`;

  const chatLog = $("#chatLog");
  const chatInput = $("#chatInput");
  const chatSend = $("#chatSend");
  const chatStatus = $("#chatStatus");

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
      const labelTemplate = t("lobby.memberLabel", "{name} ({id})");
      const idShort = m.id ? m.id.slice(0, 6) : "";
      label.textContent = labelTemplate
        .replace("{name}", m.name || "")
        .replace("{id}", idShort || "");
      row.appendChild(badge);
      row.appendChild(label);
      membersEl.appendChild(row);
    });
  }

  function addMsg(elClass, text) {
    const div = document.createElement("div");
    div.className = "msg " + elClass;
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }
  function addSys(text) {
    const div = document.createElement("div");
    div.className = "msg sys";
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  let ws,
    focused = true;
  window.addEventListener("focus", () => (focused = true));
  window.addEventListener("blur", () => (focused = false));

  let myId = null;
  let rosterMembers = [];

  function connect() {
    try {
      ws = new WebSocket(CHAT_URL);
      ws.onopen = () => {
        chatStatus.textContent = t("lobby.chatConnected", "接続しました");
      };
      ws.onclose = () => {
        chatStatus.textContent = t(
          "lobby.chatReconnecting",
          "切断されました。再接続を試みます…"
        );
        setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        chatStatus.textContent = t("lobby.chatError", "エラーが発生しました");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);

          if (data.rtc) {
            onRtcSignal(data);
            return;
          }

          if (data.sys) {
            if (data.type === "welcome") {
              myId = data.id;
            } else if (data.type === "history" && Array.isArray(data.messages)) {
              data.messages.forEach((line) => {
                try {
                  const obj = JSON.parse(line);
                  const klass = obj.name === user ? "me" : "other";
                  const text = t("lobby.chatLine", "{name}: {text}")
                    .replace("{name}", obj.name || "")
                    .replace("{text}", obj.text || "");
                  addMsg(klass, text);
                } catch {}
              });
              addSys(t("lobby.historyLoaded", "— 過去のメッセージを読み込みました —"));
            } else if (data.type === "roster") {
              rosterMembers = Array.isArray(data.members) ? data.members : [];
              renderMembers(rosterMembers);
              if (localStream) startCalls(rosterMembers);
            } else if (data.type === "join") {
              const tpl = t(
                "lobby.joined",
                "{name} が参加しました（合計 {count} 名）"
              );
              addSys(
                tpl
                  .replace("{name}", data.name || "")
                  .replace("{count}", String(data.count || 0))
              );
            } else if (data.type === "leave") {
              const tpl = t(
                "lobby.left",
                "{name} が退出しました（合計 {count} 名）"
              );
              addSys(
                tpl
                  .replace("{name}", data.name || "")
                  .replace("{count}", String(data.count || 0))
              );
              if (data.id) cleanupPeer(data.id);
            }
            return;
          }

          const obj = data;
          const klass = obj.name === user ? "me" : "other";
          const label = t("lobby.chatLine", "{name}: {text}")
            .replace("{name}", obj.name || "")
            .replace("{text}", obj.text || "");
          addMsg(klass, label);
        } catch {
        }
      };
    } catch (e) {
      chatStatus.textContent = t("lobby.chatConnectFailed", "接続に失敗しました");
      console.error(e);
    }
  }
  connect();

  chatSend.onclick = () => {
    const tval = (chatInput.value || "").trim();
    if (!tval || !ws || ws.readyState !== 1) return;
    ws.send(tval);
    chatInput.value = "";
  };
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatSend.click();
    }
  });

  // ========= 「執事に質問（音声）」 STT (Workers AI Whisper) 版 =========
  const voiceAskBtn = $("#voiceAskBtn");
  const voiceAskStatus = $("#voiceAskStatus");

  // ★ STT Worker のエンドポイント
  const STT_ENDPOINT = "https://do-stt.awachima7.workers.dev/";

  function setupVoiceAsk() {
    if (!voiceAskBtn || !voiceAskStatus) return;

    const baseLabel = t("lobby.voiceAskButton", "執事に質問（音声）");
    const recordingLabel = t("lobby.voiceAskRecordingBtn", "録音停止");

    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasRecorder = typeof window.MediaRecorder !== "undefined";

    if (!hasMedia || !hasRecorder) {
      voiceAskBtn.style.display = "none";
      voiceAskStatus.textContent = t(
        "lobby.voiceAskNotSupported",
        "お使いのブラウザでは音声での質問機能はご利用いただけません。"
      );
      return;
    }

    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let isBusy = false;

    async function sendAudioToServer(blob) {
      const processingText = t(
        "lobby.voiceAskProcessing",
        "音声をテキストに変換しています…"
      );
      const sentText = t(
        "lobby.voiceAskSent",
        "音声でのご質問を送信しました。"
      );
      const noText = t(
        "lobby.voiceAskNoText",
        "音声が認識できませんでした。もう一度お試しください。"
      );
      const errorText = t(
        "lobby.voiceAskError",
        "音声認識中にエラーが発生しました。もう一度お試しください。"
      );

      voiceAskStatus.textContent = processingText;

      try {
        const res = await fetch(STT_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": blob.type || "application/octet-stream"
          },
          body: blob
        });

        if (!res.ok) {
          console.error("STT response not ok:", res.status, await res.text());
          voiceAskStatus.textContent = errorText;
          return;
        }

        let data = null;
        try {
          data = await res.json();
        } catch (e) {
          console.error("STT json parse error", e);
        }

        const text = (data && typeof data.text === "string" ? data.text : "").trim();

        if (text) {
          chatInput.value = text;
          chatSend.click();
          voiceAskStatus.textContent = sentText;
        } else {
          voiceAskStatus.textContent = noText;
        }
      } catch (e) {
        console.error("STT fetch error", e);
        voiceAskStatus.textContent = errorText;
      }
    }

    async function startRecording() {
      if (isRecording || isBusy) return;

      const listeningText = t(
        "lobby.voiceAskListening",
        "「執事に質問」をお話しください。もう一度ボタンを押すと終了します。"
      );
      voiceAskStatus.textContent = listeningText;

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          }
        });

        audioChunks = [];
        mediaRecorder = new MediaRecorder(stream);

        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data && ev.data.size > 0) {
            audioChunks.push(ev.data);
          }
        };

        mediaRecorder.onstop = async () => {
          try {
            try {
              stream.getTracks().forEach((t) => t.stop());
            } catch (e) {}

            if (!audioChunks.length) {
              const stoppedText = t(
                "lobby.voiceAskStopped",
                "音声入力を終了しました。"
              );
              voiceAskStatus.textContent = stoppedText;
              return;
            }

            const blobType = mediaRecorder.mimeType || "audio/webm";
            const blob = new Blob(audioChunks, { type: blobType });

            await sendAudioToServer(blob);
          } finally {
            mediaRecorder = null;
            audioChunks = [];
            isBusy = false;
          }
        };

        mediaRecorder.start();
        isRecording = true;
        voiceAskBtn.classList.add("active");
        voiceAskBtn.textContent = recordingLabel;
      } catch (e) {
        console.error("voiceAsk getUserMedia error", e);
        const micError = t(
          "lobby.voiceAskMicError",
          "マイクが使用できません。ブラウザの設定をご確認ください。"
        );
        voiceAskStatus.textContent = micError;
        isRecording = false;
        isBusy = false;
        voiceAskBtn.classList.remove("active");
        voiceAskBtn.textContent = baseLabel;
      }
    }

    async function stopRecording() {
      if (!isRecording || !mediaRecorder) {
        isRecording = false;
        voiceAskBtn.classList.remove("active");
        voiceAskBtn.textContent = baseLabel;
        return;
      }
      if (isBusy) return;

      isBusy = true;
      isRecording = false;
      voiceAskBtn.classList.remove("active");
      voiceAskBtn.textContent = baseLabel;

      try {
        if (mediaRecorder.state !== "inactive") {
          mediaRecorder.stop();
        }
      } catch (e) {
        console.error("mediaRecorder stop error", e);
        isBusy = false;
      }
    }

    voiceAskBtn.addEventListener("click", (ev) => {
      ev.preventDefault();
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    });

    const readyText = t(
      "lobby.voiceAskReady",
      "ボタンを押すと、執事への質問を音声で録音します。"
    );
    voiceAskStatus.textContent = readyText;
  }

  // ========= WebRTC (voice) =========
  const iceServers = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302"
      ]
    }
  ];
  const pcConfig = { iceServers };

  let localStream = null;
  const peers = new Map();
  const audios = new Map();

  let audioCtx = null;
  function getAudioCtx() {
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      return audioCtx;
    } catch (_) {
      return null;
    }
  }
  function bindRemoteToAudioCtx(stream) {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      const src = ctx.createMediaStreamSource(stream);
      src.connect(ctx.destination);
    } catch (e) {}
  }
  function wsSend(obj) {
    try {
      ws?.readyState === 1 && ws.send(JSON.stringify(obj));
    } catch {}
  }

  function createPeer(peerId) {
    const pc = new RTCPeerConnection(pcConfig);
    pc.ontrack = (ev) => {
      let el = audios.get(peerId);
      if (!el) {
        el = document.createElement("audio");
        el.autoplay = true;
        el.playsInline = true;
        el.muted = false;
        el.volume = 1;
        audios.set(peerId, el);
        document.body.appendChild(el);
      }
      el.srcObject = ev.streams[0];
      try {
        el.play();
      } catch (e) {}
      bindRemoteToAudioCtx(ev.streams[0]);
      maybeShowEnableButton();
    };
    pc.onicecandidate = (ev) => {
      if (ev.candidate)
        wsSend({ rtc: { to: peerId, type: "candidate", data: ev.candidate } });
    };
    pc.oniceconnectionstatechange = () =>
      console.info("[ICE]", peerId, pc.iceConnectionState);
    pc.onconnectionstatechange = () =>
      console.info("[PC]", peerId, pc.connectionState);
    if (localStream && localStream.getAudioTracks().length) {
      for (const track of localStream.getAudioTracks()) pc.addTrack(track, localStream);
    } else {
      try {
        pc.addTransceiver("audio", { direction: "recvonly" });
      } catch {}
    }
    peers.set(peerId, pc);
    return pc;
  }

  async function callPeer(peerId) {
    const pc = createPeer(peerId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    wsSend({ rtc: { to: peerId, type: "offer", data: offer } });
  }

  function startCalls(memberList) {
    if (!localStream) return;
    const others = (memberList || []).filter((m) => m.id && m.id !== myId);
    for (const m of others) if (!peers.has(m.id)) callPeer(m.id);
  }

  function cleanupPeer(peerId) {
    const pc = peers.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {}
      peers.delete(peerId);
    }
    const el = audios.get(peerId);
    if (el) {
      try {
        el.srcObject = null;
        el.remove();
      } catch {}
      audios.delete(peerId);
    }
  }

  function onRtcSignal(msg) {
    const { from, type, data } = msg.rtc;
    if (!from || from === myId) return;
    let pc = peers.get(from);
    if (!pc) pc = createPeer(from);
    if (type === "offer") {
      pc.setRemoteDescription(new RTCSessionDescription(data))
        .then(() => pc.createAnswer())
        .then((ans) =>
          pc.setLocalDescription(ans).then(() =>
            wsSend({ rtc: { to: from, type: "answer", data: ans } })
          )
        )
        .catch(console.error);
    } else if (type === "answer") {
      pc.setRemoteDescription(new RTCSessionDescription(data)).catch(console.error);
    } else if (type === "candidate") {
      pc.addIceCandidate(new RTCIceCandidate(data)).catch(console.error);
    }
  }

  const voicePowerBtn = document.getElementById("voicePower");
  const micToggleBtn  = document.getElementById("micToggle");
  const voiceHint     = document.getElementById("voiceHint");

  function isMicEnabled() {
    if (!localStream) return false;
    const ttrack = localStream.getAudioTracks()[0];
    return !!(ttrack && ttrack.enabled);
  }

  function updateVoiceUI() {
    const on = !!localStream;
    const labelOn  = t("lobby.voiceOn", "音声ON");
    const labelOff = t("lobby.voiceOff", "音声OFF");
    const muteLabel   = t("lobby.mute", "ミュート");
    const unmuteLabel = t("lobby.unmute", "ミュート解除");
    const statusJoin  = t(
      "lobby.voiceJoined",
      "音声: 参加中（マイク{state}）"
    );
    const statusNone  = t("lobby.voiceNone", "音声: 未参加");

    voicePowerBtn.textContent = on ? labelOff : labelOn;
    voicePowerBtn.classList.toggle("ghost", !on);
    micToggleBtn.style.display = on ? "" : "none";

    if (on) {
      const enabled = isMicEnabled();
      micToggleBtn.textContent = enabled ? muteLabel : unmuteLabel;
      voiceHint.textContent = statusJoin.replace("{state}", enabled ? "ON" : "OFF");
    } else {
      micToggleBtn.textContent = muteLabel;
      voiceHint.textContent = statusNone;
    }
  }

  async function startVoice() {
    try {
      if (localStream) {
        stopVoice();
      }
      const errorMsg = t(
        "lobby.micErrorMsg",
        "マイクへのアクセスを許可してください。ブラウザの設定を確認するか、ページを再読み込みしてください。"
      );

      localStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

      startCalls(rosterMembers);
      updateVoiceUI();
      await tryPlayAllAudios();
      await resumeAudioContext();
    } catch (e) {
      console.error("mic error", e);
      voiceHint.textContent = errorMsg;
      alert(errorMsg);
      stopVoice();
    }
  }

  function stopVoice() {
    for (const id of Array.from(peers.keys())) cleanupPeer(id);
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    updateVoiceUI();
  }

  voicePowerBtn.onclick = async () => {
    if (!localStream) {
      await startVoice();
    } else {
      stopVoice();
    }
    maybeShowEnableButton();
  };

  micToggleBtn.onclick = () => {
    if (!localStream) return;
    const tr = localStream.getAudioTracks()[0];
    if (!tr) return;
    tr.enabled = !tr.enabled;
    updateVoiceUI();
  };

  const enableBtn = document.getElementById("enableSound");
  function anyAudioPlaying() {
    let ok = false;
    audios.forEach((el) => {
      if (!el.paused) ok = true;
    });
    return ok;
  }
  async function tryPlayAllAudios() {
    for (const el of audios.values()) {
      try {
        el.volume = 1;
        el.muted = false;
        await el.play();
      } catch (e) {}
    }
    document.querySelectorAll("audio").forEach(async (el) => {
      try {
        el.volume = 1;
        el.muted = false;
        await el.play();
      } catch (e) {}
    });
  }
  async function resumeAudioContext() {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return false;
      if (ctx.state !== "running") {
        await ctx.resume();
      }
      return ctx.state === "running";
    } catch (_) {
      return false;
    }
  }
  async function enableSound() {
    const labelRetry = t(
      "lobby.enableSoundRetry",
      "音が出ない？もう一度有効化"
    );
    const r1 = await resumeAudioContext();
    await tryPlayAllAudios();
    if (r1 || anyAudioPlaying()) {
      enableBtn.style.display = "none";
    } else {
      enableBtn.textContent = labelRetry;
      enableBtn.style.display = "";
    }
  }
  function maybeShowEnableButton() {
    if (!isMobile) return;
    const ctxOk = audioCtx && audioCtx.state === "running";
    if (ctxOk || anyAudioPlaying()) {
      enableBtn.style.display = "none";
    } else {
      enableBtn.style.display = "";
    }
  }
  function setupMobileAudioGate() {
    if (!isMobile) return;
    enableBtn.style.display = "";
    enableBtn.onclick = enableSound;
    const retry = async () => {
      await enableSound();
    };
    document.addEventListener("touchend", retry);
    document.addEventListener("click", retry);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) maybeShowEnableButton();
    });
  }
  setupMobileAudioGate();

  chatStatus.textContent = t("lobby.chatInitial", "接続していません");
  updateVoiceUI();

  setupVoiceAsk();
})();
