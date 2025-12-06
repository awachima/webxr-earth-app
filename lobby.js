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
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("fa")) return "fa";
  if (lower.startsWith("hi")) return "hi";
  if (lower.startsWith("he") || lower.startsWith("iw")) return "he";
  return "en";
}

(function () {
  const urlParams = new URLSearchParams(location.search);

  // ===== i18n 初期化 =====
  let currentLang = (function () {
    // 1) URL パラメータ ?lang=xxx があれば最優先
    try {
      const urlLang = urlParams.get("lang");
      if (urlLang) {
        // ★ 互換性対応: "ja" は "ja-JP" とみなす
        if (urlLang === "ja") return "ja-JP";
        return urlLang;
      }
    } catch (e) {}

    // 2) localStorage の lang
    try {
      const saved = localStorage.getItem("lang");
      if (saved) {
        // ★ 互換性対応: "ja" は "ja-JP" とみなす
        if (saved === "ja") return "ja-JP";
        return saved;
      }
    } catch (e) {}

    // 3) それもなければブラウザから推定
    return detectLang();
  })();

  // lang / dir の初期設定
  (function () {
    const root = document.documentElement;
    root.lang = currentLang || "en";
    if (currentLang === "fa" || currentLang === "he") {
      root.dir = "rtl";
    } else {
      root.dir = "ltr";
    }
  })();

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
    if (headerTitle)
      headerTitle.textContent = t("lobby.title", "待ち合わせロビー");

    const setNameBtn = $("#setName");
    if (setNameBtn)
      setNameBtn.textContent = t("lobby.setName", "ニックネーム");

    const backBtn = $("#backToIndex");
    if (backBtn)
      backBtn.textContent = t("lobby.backButton", "← 戻る");

    const countdownLabel = $("#countdownLabel");
    if (countdownLabel)
      countdownLabel.textContent = t(
        "lobby.countdownLabel",
        "開始までの時間"
      );

    const infoLabel = $("#infoLabel");
    if (infoLabel)
      infoLabel.textContent = t("lobby.infoLabel", "待合室情報");

    const dateLabel = $("#dateLabel");
    if (dateLabel) dateLabel.textContent = t("lobby.dateLabel", "開始日時");

    const limitLabel = $("#limitLabel");
    if (limitLabel)
      limitLabel.textContent = t("lobby.limitLabel", "参加上限");

    const urlLabel = $("#urlLabel");
    if (urlLabel) urlLabel.textContent = t("lobby.urlLabel", "ツアーURL");

    const eventTypeLabel = $("#eventTypeLabel");
    if (eventTypeLabel)
      eventTypeLabel.textContent = t("lobby.eventTypeLabel", "種別");

    const priceLabel = $("#priceLabel");
    if (priceLabel)
      priceLabel.textContent = t("lobby.priceLabel", "価格");

    const membersLabel = $("#membersLabel");
    if (membersLabel)
      membersLabel.textContent = t("lobby.membersLabel", "参加者");

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

    const chatInput = $("#chatInput");
    if (chatInput)
      chatInput.placeholder = t(
        "lobby.chatPlaceholder",
        "メッセージを入力…"
      );

    const voiceAskBtn = $("#voiceAskBtn");
    if (voiceAskBtn)
      // ★ デフォルト文言を「執事に質問（音声）」に統一
      voiceAskBtn.textContent = t(
        "lobby.voiceAskBtn",
        "執事に質問（音声）"
      );

    const langSelect = $("#langSelect");
    if (langSelect) {
      const langLabel = $("#langLabel");
      if (langLabel)
        langLabel.textContent = t("lobby.languageLabel", "表示言語");

      langSelect.innerHTML = "";
      const langs = [
        { value: "en", label: "English" },
        { value: "ja-JP", label: "日本語" },
        { value: "zh-CN", label: "中文" },
        { value: "fa", label: "فارسی" },
        { value: "hi", label: "हिन्दी" },
        { value: "he", label: "עברית" },
      ];
      langs.forEach((lng) => {
        const opt = document.createElement("option");
        opt.value = lng.value;
        opt.textContent = lng.label;
        if (lng.value === currentLang) opt.selected = true;
        langSelect.appendChild(opt);
      });
    }

    const dateValue = $("#dateValue");
    if (dateValue) dateValue.textContent = "-";

    const limitValue = $("#limitValue");
    if (limitValue) limitValue.textContent = "-";

    const urlValue = $("#urlValue");
    if (urlValue) urlValue.textContent = "-";

    const eventTypeValue = $("#eventTypeValue");
    if (eventTypeValue)
      eventTypeValue.textContent = t("lobby.eventTypeUnknown", "不明");

    const priceValue = $("#priceValue");
    if (priceValue) priceValue.textContent = "-";

    const enterBtn = $("#enterBtn");
    if (enterBtn)
      enterBtn.textContent = t("lobby.enterButton", "ツアーに行く");

    const chatSend = $("#chatSend");
    if (chatSend) chatSend.textContent = t("lobby.chatSend", "送信");

    const lobbyFooter = $("#lobbyFooter");
    if (lobbyFooter)
      lobbyFooter.textContent = t("lobby.footer", "© DokodemoDoors");
  }

  async function loadLangData(lang) {
    let url = "./lang/en.json";
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

  // 言語セレクト変更
  const langSelect = $("#langSelect");
  if (langSelect) {
    langSelect.addEventListener("change", (e) => {
      const value = e.target.value;
      currentLang = value;
      try {
        localStorage.setItem("lang", value);
      } catch (e) {}
      if (value === "he") {
        document.documentElement.dir = "rtl";
      } else {
        document.documentElement.dir = "ltr";
      }
      loadLangData(value);
    });
  }

  // ===== URL パラメータ =====
  // const urlParams = new URLSearchParams(location.search);  // 上部で定義済み
  const roomId = urlParams.get("roomId") || "default";
  const title = urlParams.get("title") || "";
  const start = urlParams.get("start") || "";
  const limit = urlParams.get("limit") || "";
  const target = urlParams.get("target") || "";
  const eventType = urlParams.get("eventType") || "";
  const price = urlParams.get("price") || "";

  // ===== タイトル表示 =====
  const titleEl = $("#title");
  if (titleEl) {
    titleEl.textContent = title || t("lobby.noTitle", "タイトル未設定");
  }

  // ===== 情報表示 =====
  const dateValue = $("#dateValue");
  const limitValue = $("#limitValue");
  const urlValue = $("#urlValue");
  const eventTypeValue = $("#eventTypeValue");
  const priceValue = $("#priceValue");

  if (start && dateValue) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) {
      const y = d.getFullYear();
      const mo = d.getMonth() + 1;
      const da = d.getDate();
      const hh = pad(d.getHours());
      const mm = pad(d.getMinutes());
      dateValue.textContent = `${y}/${mo}/${da} ${hh}:${mm}`;
    } else {
      dateValue.textContent = t("lobby.dateUnknown", "未定");
    }
  }

  if (limitValue) {
    if (!limit || Number(limit) <= 0) {
      limitValue.textContent = t("lobby.limitNone", "制限なし");
    } else {
      limitValue.textContent = t("lobby.limitValue", "{count}人").replace(
        "{count}",
        String(limit)
      );
    }
  }

  if (urlValue) {
    urlValue.textContent = target || "-";
  }

  if (eventTypeValue) {
    let label = "";
    if (eventType === "official") {
      label = t("lobby.eventTypeOfficial", "公式イベント");
    } else if (eventType === "fan") {
      label = t("lobby.eventTypeFan", "ファン企画");
    } else if (eventType === "private") {
      label = t("lobby.eventTypePrivate", "非公開");
    } else {
      label = t("lobby.eventTypeUnknown", "不明");
    }
    eventTypeValue.textContent = label;
  }

  if (priceValue) {
    if (!price) {
      priceValue.textContent = t("lobby.priceFree", "無料");
    } else {
      priceValue.textContent = t("lobby.priceValue", "{price}").replace(
        "{price}",
        price
      );
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
        "lobby.statusNoStartDetail",
        "開始時刻が設定されていません。"
      );
      return;
    }

    const startDate = new Date(start);
    if (isNaN(startDate.getTime())) {
      countEl.textContent = t("lobby.statusNoStart", "未設定");
      statusEl.textContent = t(
        "lobby.statusNoStartDetail",
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
        countEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;
        statusEl.textContent = t(
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
        countEl.textContent = label;
        statusEl.textContent = t(
          "lobby.statusStarted",
          "ツアー中です。途中参加も可能です。"
        );
        requestAnimationFrame(update);
        return;
      }

      countEl.textContent = t(
        "lobby.statusExpiredShort",
        "期限切れ"
      );
      statusEl.textContent = t(
        "lobby.statusExpiredDetail",
        "イベントは終了し、待合室は無効になっています。"
      );
    }

    update();
  }

  setupCountdown();

  // ===== 入室ボタン =====
  const enterBtn2 = $("#enterBtn");
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

  // ===== チャット用 UI =====
  const chatLog = $("#chatLog");
  const chatInput = $("#chatInput");
  const chatSend = $("#chatSend");
  const chatStatus = $("#chatStatus");
  const debugEl = $("#debug");

  function logDebug(msg) {
    if (!debugEl) return;
    const time = new Date().toISOString().slice(11, 19);
    debugEl.textContent += `[${time}] ${msg}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  function addSys(text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg sys";
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  function addMsg(kind, text) {
    if (!chatLog) return;
    const div = document.createElement("div");
    div.className = "msg " + kind;
    div.textContent = text;
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // 「Reginald 考え中」インジケーター
  let thinkingElem = null;
  function showThinking() {
    if (!chatLog) return;
    if (thinkingElem) return;
    const div = document.createElement("div");
    div.className = "msg sys thinking";
    // ★ フォールバックを日本語に
    div.textContent = t(
      "lobby.botThinking",
      "Reginald が考え中です…"
    );
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
    thinkingElem = div;
  }
  function hideThinking() {
    if (thinkingElem && thinkingElem.parentNode) {
      thinkingElem.parentNode.removeChild(thinkingElem);
    }
    thinkingElem = null;
  }

  let ws,
    focused = true;
  window.addEventListener("focus", () => (focused = true));
  window.addEventListener("blur", () => (focused = false));

  let myId = null;
  let rosterMembers = [];

  // ===== WebSocket（チャット + シグナリング） =====
  const WS_BASE = "wss://do-chat.awachima7.workers.dev";
  const pageParams = new URLSearchParams(location.search);
  pageParams.set("user", user);
  const CHAT_URL = `${WS_BASE}/ws/${encodeURIComponent(
    roomId
  )}?${pageParams.toString()}`;

  function connect() {
    try {
      ws = new WebSocket(CHAT_URL);
      ws.onopen = () => {
        chatStatus.textContent = t(
          "lobby.chatConnected",
          "接続しました"
        );
        logDebug("WebSocket connected");
      };
      ws.onclose = () => {
        chatStatus.textContent = t(
          "lobby.chatReconnecting",
          "切断されました。再接続を試みます…"
        );
        logDebug("WebSocket closed, retry in 1500ms");
        setTimeout(connect, 1500);
      };
      ws.onerror = (e) => {
        chatStatus.textContent = t(
          "lobby.chatError",
          "エラーが発生しました"
        );
        logDebug("WebSocket error: " + e?.message);
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);

          // WebRTC シグナリング
          if (data && data.rtc) {
            const rtc = data.rtc;
            const from = rtc.from;
            if (from && from !== myId) {
              handleRTC(from, rtc);
            }
            return;
          }

          // システムメッセージ
          if (data.sys) {
            if (data.type === "welcome") {
              myId = data.id;
              logDebug("Welcome, myId = " + myId);
            } else if (
              data.type === "history" &&
              Array.isArray(data.messages)
            ) {
              data.messages.forEach((line) => {
                try {
                  const obj = JSON.parse(line);
                  if (obj.name === "Reginald") {
                    hideThinking();
                  }
                  const klass = obj.name === user ? "me" : "other";
                  const text = t(
                    "lobby.chatLine",
                    "{name}: {text}"
                  )
                    .replace("{name}", obj.name || "")
                    .replace("{text}", obj.text || "");
                  addMsg(klass, text);
                } catch {}
              });
              addSys(
                t(
                  "lobby.historyLoaded",
                  "— 過去のメッセージを読み込みました —"
                )
              );
            } else if (data.type === "roster") {
              rosterMembers = Array.isArray(data.members)
                ? data.members
                : [];
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
            } else if (data.type === "bot-thinking") {
              showThinking();
            } else if (data.type === "bot-done") {
              hideThinking();
            }
            return;
          }

          // 通常チャット
          const obj = data;
          if (obj.name === "Reginald") {
            hideThinking();
          }
          const klass = obj.name === user ? "me" : "other";
          const label = t("lobby.chatLine", "{name}: {text}")
            .replace("{name}", obj.name || "")
            .replace("{text}", obj.text || "");
          addMsg(klass, label);
        } catch (e) {
          // 非 JSON は無視
        }
      };
    } catch (e) {
      chatStatus.textContent = t(
        "lobby.chatError",
        "エラーが発生しました"
      );
      logDebug("WebSocket init error: " + e?.message);
    }
  }

  connect();

  if (chatSend && chatInput) {
    chatSend.addEventListener("click", () => {
      const text = chatInput.value.trim();
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
      ws.send(
        JSON.stringify({
          type: "chat",
          text,
          name: user || "Guest",
        })
      );
      chatInput.value = "";
    });

    chatInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        chatSend.click();
      }
    });
  }

  // ===== WebRTC 音声チャット =====
  const voiceStatus = $("#voiceStatus");
  const voicePowerBtn = $("#voicePower");
  const micToggleBtn = $("#micToggle");
  const voiceHintEl = $("#voiceHint");

  let localStream = null;
  const peers = new Map(); // id -> RTCPeerConnection
  const remoteAudios = new Map(); // id -> HTMLAudioElement
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
    if (voiceStatus) {
      if (!voiceJoined) {
        voiceStatus.textContent = t("lobby.voiceNone", "音声: 未参加");
      } else {
        const state = micMuted
          ? t("lobby.mute", "ミュート")
          : t("lobby.unmute", "ミュート解除");
        voiceStatus.textContent = t(
          "lobby.voiceJoined",
          "音声: 参加中（マイク{state}）"
        ).replace("{state}", state);
      }
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
      alert(
        t(
          "lobby.micDenied",
          "マイクへのアクセスが拒否されました。ブラウザの設定を確認してください。"
        )
      );
      return;
    }

    voiceJoined = true;
    micMuted = false;
    updateVoiceUI();

    if (voiceStatus) {
      voiceStatus.textContent = t(
        "lobby.voiceJoining",
        "音声チャンネルに参加しています…"
      );
    }

    if (rosterMembers.length > 0) {
      startCalls(rosterMembers);
    }
  }

  function leaveVoice() {
    voiceJoined = false;
    micMuted = false;
    updateVoiceUI();

    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
      localStream = null;
    }
    for (const pc of peers.values()) {
      pc.close();
    }
    peers.clear();
    for (const audio of remoteAudios.values()) {
      audio.remove();
    }
    remoteAudios.clear();

    if (voiceStatus) {
      voiceStatus.textContent = t(
        "lobby.voiceLeft",
        "音声チャンネルから退出しました。"
      );
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
      if (!voiceJoined || !localStream) return;
      micMuted = !micMuted;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !micMuted;
      });
      updateVoiceUI();
    });
  }

  function makePC(id) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(
        JSON.stringify({
          rtc: {
            type: "candidate",
            to: id,
            candidate: ev.candidate,
          },
        })
      );
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

    if (localStream) {
      localStream.getTracks().forEach((track) => {
        pc.addTrack(track, localStream);
      });
    }

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
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            rtc: {
              type: "offer",
              to: m.id,
              sdp: offer.sdp,
            },
          })
        );
      }
    }
  }

  async function handleRTC(from, rtc) {
    const { type } = rtc;
    if (type === "offer") {
      let pc = peers.get(from);
      if (!pc) pc = makePC(from);
      await pc.setRemoteDescription(
        new RTCSessionDescription({ type: "offer", sdp: rtc.sdp })
      );
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            rtc: {
              type: "answer",
              to: from,
              sdp: answer.sdp,
            },
          })
        );
      }
    } else if (type === "answer") {
      const pc = peers.get(from);
      if (pc) {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: "answer", sdp: rtc.sdp })
        );
      }
    } else if (type === "candidate") {
      const pc = peers.get(from);
      if (pc && rtc.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(rtc.candidate));
        } catch (e) {}
      }
    }
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

  // ===== iOS / Safari 向け AudioContext 初期化 =====
  (function initAudioContextOnce() {
    if (window._audioContext) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      window._audioContext = ctx;
      const resume = () => {
        if (ctx.state === "suspended") {
          ctx.resume();
        }
        window.removeEventListener("touchstart", resume);
        window.removeEventListener("click", resume);
      };
      window.addEventListener("touchstart", resume);
      window.addEventListener("click", resume);
    } catch (e) {}
  })();
})();
