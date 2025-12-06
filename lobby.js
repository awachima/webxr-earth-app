// ===== 共通ヘルパー・定数 =====
const $ = (s) => document.querySelector(s);
const S = "meetups-store";
const O = "meetups-owners";
const NEGATIVE_LIMIT_MS = 20 * 60 * 1000;

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

// ===== 言語の推定 =====
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
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("fa")) return "fa";
  if (lower.startsWith("hi")) return "hi";
  if (lower.startsWith("he") || lower.startsWith("iw")) return "he";
  return "en";
}

(function () {
  // ===== URL パラメータ（共通） =====
  const urlParams = new URLSearchParams(location.search);

  // ===== i18n 初期化 =====
  let currentLang = (function () {
    const urlLang = urlParams.get("lang");
    if (urlLang) {
      // ★ 互換性対応: "ja" は "ja-JP" とみなす
      if (urlLang === "ja") return "ja-JP";
      return urlLang;
    }
    try {
      const saved = localStorage.getItem("lang");
      if (saved) {
        // ★ 互換性対応: "ja" は "ja-JP" とみなす
        if (saved === "ja") return "ja-JP";
        return saved;
      }
    } catch (e) {}
    return detectLang();
  })();

  // lang に対応して dir を設定（ヘブライ語など右から左）
  if (currentLang === "he") {
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

  // ===== ロビー用 文言適用 =====
  function applyLobbyTexts() {
    const headerTitle = $("#lobbyHeaderTitle");
    if (headerTitle)
      headerTitle.textContent = t("lobby.headerTitle", "待ち合わせロビー");

    const setNameBtn = $("#setName");
    if (setNameBtn)
      setNameBtn.textContent = t("lobby.nicknameButton", "ニックネーム");

    const backBtn = $("#backToIndex");
    if (backBtn)
      backBtn.textContent = t("lobby.backButton", "← 戻る");

    const countdownLabel = $("#countdownLabel");
    if (countdownLabel)
      countdownLabel.textContent = t("lobby.countdownLabel", "カウントダウン");

    const enterBtn = $("#enter");
    if (enterBtn)
      enterBtn.textContent = t("lobby.enterButton", "ツアーに行く");

    const copyBtn = $("#copy");
    if (copyBtn)
      copyBtn.textContent = t(
        "lobby.copyRoomUrl",
        "この待合室のURLをコピー"
      );

    const chatSend = $("#chatSend");
    if (chatSend)
      chatSend.textContent = t("lobby.chatSend", "送信");

    const chatInput = $("#chatInput");
    if (chatInput)
      chatInput.placeholder = t(
        "lobby.chatPlaceholder",
        "メッセージを入力…"
      );

    const voiceSectionTitle = $("#voiceSectionTitle");
    if (voiceSectionTitle)
      voiceSectionTitle.textContent = t(
        "lobby.voiceSectionTitle",
        "ボイスチャット"
      );

    const voiceControlLabel = $("#voiceControlLabel");
    if (voiceControlLabel)
      voiceControlLabel.textContent = t(
        "lobby.voiceControlLabel",
        "ボイスチャット"
      );

    const textChatLabel = $("#textChatLabel");
    if (textChatLabel)
      textChatLabel.textContent = t("lobby.textChatLabel", "テキストチャット");

    const enableSound = $("#enableSound");
    if (enableSound)
      enableSound.textContent = t(
        "lobby.enableSound",
        "スマホで音を有効化"
      );

    const chatStatus = $("#chatStatus");
    if (chatStatus)
      chatStatus.textContent = t("lobby.chatInitial", "接続していません");

    const lobbyFooter = $("#lobbyFooter");
    if (lobbyFooter)
      lobbyFooter.textContent = t("lobby.footer", "© DokodemoDoors");
  }

  async function loadLangData(lang) {
    let url = "./lang/en.json";
    // ★ "ja" も "ja-JP" と同じ扱いにする
    if (lang === "ja-JP" || lang === "ja") url = "./lang/ja.json";
    else if (lang === "zh-CN") url = "./lang/zh.json";
    else if (lang === "fa") url = "./lang/fa.json";
    else if (lang === "hi") url = "./lang/hi.json";
    else if (lang === "he") url = "./lang/he.json";

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

  // 言語データ読み込み
  loadLangData(currentLang);

  // 言語セレクト変更（※現状 lobby.html にはセレクトは無いので、あれば動く）
  const langSelect = $("#langSelect");
  if (langSelect) {
    langSelect.addEventListener("change", (e) => {
      const v = e.target.value;
      currentLang = v;
      try {
        localStorage.setItem("lang", v === "ja-JP" ? "ja" : v);
      } catch (e2) {}
      loadLangData(currentLang);
    });
  }

  // ===== URL パラメータ =====
  // （urlParams はファイル冒頭で定義済み）
  const roomId = urlParams.get("roomId") || "default";
  const title = urlParams.get("title") || "";
  const start = urlParams.get("start") || "";
  const limit = urlParams.get("limit") || "";
  const target = urlParams.get("target") || "";
  const eventType = urlParams.get("eventType") || "";
  const price = urlParams.get("price") || "";

  // ===== タイトル・メタ情報表示 =====
  const titleEl = $("#title");
  if (titleEl) titleEl.textContent = title || "（タイトル未設定）";

  const metaEl = $("#meta");
  if (metaEl) {
    if (start) {
      const d = new Date(start);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const mo = d.getMonth() + 1;
        const da = d.getDate();
        const hh = pad(d.getHours());
        const mm = pad(d.getMinutes());
        metaEl.textContent = `開始時刻：${y}/${mo}/${da} ${hh}:${mm}`;
      } else {
        metaEl.textContent = t(
          "lobby.statusNoStart",
          "開始時刻：未設定"
        );
      }
    } else {
      metaEl.textContent = t("lobby.statusNoStart", "開始時刻：未設定");
    }
  }

  // ===== 上限人数ピル =====
  const limitPill = $("#limitPill");
  if (limitPill) {
    if (!limit || Number(limit) <= 0) {
      limitPill.style.display = "none";
    } else {
      limitPill.style.display = "inline-block";
      limitPill.textContent = `参加上限：${limit}人`;
    }
  }

  // ===== カウントダウン =====
  function setupCountdown() {
    const countEl = $("#count");
    const statusEl = $("#status");
    if (!countEl || !statusEl) return;

    if (!start) {
      countEl.textContent = t("lobby.statusNoStart", "未設定");
      statusEl.textContent = t(
        "lobby.statusNoStart",
        "開始時刻が設定されていません。"
      );
      return;
    }

    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) {
      countEl.textContent = t("lobby.statusNoStart", "未設定");
      statusEl.textContent = t(
        "lobby.statusNoStart",
        "開始時刻が設定されていません。"
      );
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
        $("#status").textContent = t(
          "lobby.statusWaiting",
          "開始までお待ちください。"
        );
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
        $("#count").textContent = label;
        $("#status").textContent = t(
          "lobby.statusStarted",
          "ツアー中です。途中参加も可能です。"
        );
        requestAnimationFrame(update);
        return;
      }

      $("#count").textContent = t(
        "lobby.statusExpiredShort",
        "期限切れ"
      );
      $("#status").textContent = t(
        "lobby.statusEnded",
        "イベントは終了し、待合室は無効になっています。"
      );
    }

    update();
  }
  setupCountdown();

  // ===== 入室ボタン =====
  const enterBtn2 = $("#enter");
  if (enterBtn2) {
    enterBtn2.addEventListener("click", () => {
      if (!target) {
        alert(
          t(
            "lobby.noTargetAlert",
            "ツアーURLが設定されていないため、移動できません。"
          )
        );
        return;
      }
      window.open(target, "_blank", "noopener,noreferrer");
    });
  }

  // ===== ニックネーム設定 =====
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
      const newName = prompt(
        t(
          "lobby.setNamePrompt",
          "チャット用のニックネームを入力してください。"
        ),
        user || ""
      );
      if (!newName) return;
      user = newName;
      try {
        localStorage.setItem("nickname", newName);
      } catch (e) {}
      alert(t("lobby.setNameSaved", "ニックネームを保存しました。"));
    });
  }

  // ===== 戻るボタン =====
  const backToIndex = $("#backToIndex");
  if (backToIndex) {
    backToIndex.addEventListener("click", (e) => {
      e.preventDefault();
      window.location.href = "./index.html";
    });
  }

  // ===== Members パネル =====
  const membersEl = $("#members");
  function renderMembers(members) {
    if (!membersEl) return;
    membersEl.innerHTML = "";
    if (!members || members.length === 0) {
      const div = document.createElement("div");
      div.className = "member";
      div.textContent = t("lobby.membersEmpty", "参加者はいません。");
      membersEl.appendChild(div);
      return;
    }
    members.forEach((m) => {
      const div = document.createElement("div");
      div.className = "member";
      const nameText = m.name || "Guest";
      div.textContent = t("lobby.memberLabel", "{name}").replace(
        "{name}",
        nameText
      );
      membersEl.appendChild(div);
    });
  }

  // ===== WebSocket / 待合室チャット =====
  const debugEl = $("#debug");
  const chatLogEl = $("#chatLog");
  const chatInputEl = $("#chatInput");
  const chatSendEl = $("#chatSend");
  const chatStatusEl = $("#chatStatus");

  function addDebug(msg) {
    if (!debugEl) return;
    debugEl.textContent += msg + "\n";
  }

  function addChatLine(text) {
    if (!chatLogEl) return;
    const div = document.createElement("div");
    div.className = "line";
    div.textContent = text;
    chatLogEl.appendChild(div);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function buildWsUrl(roomId) {
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const host = location.host;
    const path = "/do-chat";
    const pageParams = new URLSearchParams(location.search);
    pageParams.set("roomId", roomId);
    pageParams.set("nickname", user || "Guest");
    return `${proto}//${host}${path}?${pageParams.toString()}`;
  }

  let ws = null;
  let reconnectTimer = null;

  function setChatStatus(key, fallback) {
    if (!chatStatusEl) return;
    chatStatusEl.textContent = t(`lobby.${key}`, fallback);
  }

  function connectWs() {
    if (!roomId) {
      setChatStatus("chatInitial", "接続していません");
      return;
    }
    const url = buildWsUrl(roomId);
    addDebug("WS connect: " + url);

    try {
      ws = new WebSocket(url);
    } catch (e) {
      addDebug("WS create error: " + e);
      setChatStatus("chatConnectFailed", "接続に失敗しました");
      return;
    }

    ws.addEventListener("open", () => {
      addDebug("WS open");
      setChatStatus("chatConnected", "接続しました");
      if (chatLogEl) {
        const div = document.createElement("div");
        div.className = "system";
        div.textContent = t(
          "lobby.historyLoaded",
          "— 過去のメッセージを読み込みました —"
        );
        chatLogEl.appendChild(div);
      }
    });

    ws.addEventListener("message", (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "members") {
          renderMembers(data.members || []);
        } else if (data.type === "chat") {
          const nameText = data.name || "Guest";
          const line = t("lobby.chatLine", "{name}: {text}")
            .replace("{name}", nameText)
            .replace("{text}", data.text || "");
          addChatLine(line);
        } else if (data.type === "system") {
          addChatLine(data.text || "");
        } else if (data.type === "join") {
          const msg = t(
            "lobby.joined",
            "{name} さんが参加しました（合計 {count} 名）"
          )
            .replace("{name}", data.name || "Guest")
            .replace("{count}", String(data.count || 0));
          addChatLine(msg);
        } else if (data.type === "leave") {
          const msg = t(
            "lobby.left",
            "{name} さんが退出しました（合計 {count} 名）"
          )
            .replace("{name}", data.name || "Guest")
            .replace("{count}", String(data.count || 0));
          addChatLine(msg);
        }
      } catch (e) {
        addDebug("WS message parse error: " + e);
      }
    });

    ws.addEventListener("close", () => {
      addDebug("WS close");
      setChatStatus("chatReconnecting", "切断されました。再接続を試みます…");
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(() => {
        connectWs();
      }, 3000);
    });

    ws.addEventListener("error", (e) => {
      addDebug("WS error: " + e);
      setChatStatus("chatError", "エラーが発生しました");
    });
  }

  if (chatInputEl && chatSendEl) {
    chatSendEl.addEventListener("click", () => {
      const text = chatInputEl.value.trim();
      if (!text) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        alert(
          t(
            "lobby.chatNotConnected",
            "チャットサーバーに接続されていません。しばらく待ってから再度お試しください。"
          )
        );
        return;
      }
      ws.send(JSON.stringify({ type: "chat", text, name: user || "Guest" }));
      chatInputEl.value = "";
    });

    chatInputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatSendEl.click();
      }
    });
  }

  connectWs();

  // ===== 音声チャット（ON/OFF とミュート） =====
  const voicePowerBtn = $("#voicePower");
  const micToggleBtn = $("#micToggle");
  const voiceHintEl = $("#voiceHint");

  let voiceJoined = false;
  let micMuted = false;

  function updateVoiceUI() {
    if (voicePowerBtn) {
      voicePowerBtn.textContent = voiceJoined
        ? t("lobby.voiceOff", "音声OFF")
        : t("lobby.voiceOn", "音声ON");
    }
    if (micToggleBtn) {
      micToggleBtn.style.display = voiceJoined ? "inline-block" : "none";
      micToggleBtn.textContent = micMuted
        ? t("lobby.unmute", "ミュート解除")
        : t("lobby.mute", "ミュート");
    }
    if (voiceHintEl) {
      if (!voiceJoined) {
        voiceHintEl.textContent = t("lobby.voiceNone", "音声: 未参加");
      } else {
        const state = micMuted
          ? t("lobby.mute", "ミュート")
          : t("lobby.unmute", "ミュート解除");
        voiceHintEl.textContent = t(
          "lobby.voiceJoined",
          "音声: 参加中（マイク{state}）"
        ).replace("{state}", state);
      }
    }
  }

  updateVoiceUI();

  if (voicePowerBtn) {
    voicePowerBtn.addEventListener("click", () => {
      voiceJoined = !voiceJoined;
      if (!voiceJoined) {
        micMuted = false;
      }
      updateVoiceUI();
    });
  }

  if (micToggleBtn) {
    micToggleBtn.addEventListener("click", () => {
      if (!voiceJoined) return;
      micMuted = !micMuted;
      updateVoiceUI();
    });
  }

  // ===== スマホで音を有効化ボタン =====
  const enableSoundBtn = $("#enableSound");
  if (enableSoundBtn) {
    enableSoundBtn.addEventListener("click", () => {
      const ctx = window._audioContext;
      if (ctx && ctx.state === "suspended") {
        ctx.resume().then(() => {
          enableSoundBtn.textContent = t(
            "lobby.enableSoundRetry",
            "音が出ない？もう一度有効化"
          );
        });
      } else {
        enableSoundBtn.textContent = t(
          "lobby.enableSoundRetry",
          "音が出ない？もう一度有効化"
        );
      }
    });
  }

  // ===== 執事に質問（音声）ボタン =====
  const voiceAskBtn = $("#voiceAskBtn");
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
    setVoiceAskStatus("botThinking", "執事が考え中です…");

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      setVoiceAskStatus(
        "micDenied",
        "マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。"
      );
      isRecording = false;
      return;
    }

    mediaRecorder = new MediaRecorder(mediaStream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) chunks.push(ev.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: "audio/webm" });
      chunks = [];
      if (!blob || blob.size === 0) {
        setVoiceAskStatus(
          "micErrorMsg",
          "音声データが取得できませんでした。もう一度お試しください。"
        );
        return;
      }
      setVoiceAskStatus(
        "botThinking",
        "執事が考え中です…（音声を送信しています）"
      );

      try {
        const formData = new FormData();
        formData.append("roomId", roomId || "default");
        formData.append("audio", blob, "voice.webm");

        const res = await fetch("/do-chat/voice", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          throw new Error("voice api error: " + res.status);
        }
        setVoiceAskStatus(
          "voiceAskSent",
          "執事に音声を送信しました。回答をお待ちください。"
        );
      } catch (e) {
        console.error(e);
        setVoiceAskStatus(
          "voiceAskError",
          "執事への音声送信に失敗しました。時間をおいて再度お試しください。"
        );
      }
    };

    mediaRecorder.start();
    setVoiceAskStatus("recording", "録音中です。もう一度押すと停止します。");
  }

  function stopRecording() {
    if (!isRecording) return;
    isRecording = false;

    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
    }
    setVoiceAskStatus("sending", "音声を送信しています…");
  }

  if (voiceAskBtn) {
    voiceAskBtn.addEventListener("click", () => {
      if (!isRecording) {
        startRecording();
      } else {
        stopRecording();
      }
    });
  }
})();
