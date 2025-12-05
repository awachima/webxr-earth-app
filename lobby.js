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
  // ===== i18n 初期化 =====
  let currentLang = (function () {
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
      eventTypeLabel.textContent = t(
        "lobby.eventTypeLabel",
        "イベント種別"
      );

    const priceLabel = $("#priceLabel");
    if (priceLabel)
      priceLabel.textContent = t("lobby.priceLabel", "参加費");

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

    const chatInput = $("#chatInput");
    if (chatInput)
      chatInput.placeholder = t(
        "lobby.chatPlaceholder",
        "メッセージを入力…"
      );

    const membersLabel = $("#membersLabel");
    if (membersLabel)
      membersLabel.textContent = t("lobby.membersLabel", "参加者");

    const voicePanelLabel = $("#voicePanelLabel");
    if (voicePanelLabel)
      voicePanelLabel.textContent = t(
        "lobby.voicePanelLabel",
        "音声・会話設定"
      );

    const voicePower = $("#voicePower");
    if (voicePower)
      voicePower.textContent = t("lobby.voicePowerOff", "音声ON");

    const micToggle = $("#micToggle");
    if (micToggle)
      micToggle.textContent = t("lobby.micToggleMute", "ミュート");

    const enableSound = $("#enableSound");
    if (enableSound)
      enableSound.textContent = t(
        "lobby.enableSound",
        "スマホで音を有効化"
      );

    const textChatLabel = $("#textChatLabel");
    if (textChatLabel)
      textChatLabel.textContent = t("lobby.textChatLabel", "テキストチャット");

    const voiceAskLabel = $("#voiceAskLabel");
    if (voiceAskLabel)
      voiceAskLabel.textContent = t(
        "lobby.voiceAskLabel",
        "執事に質問（音声）"
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
  const urlParams = new URLSearchParams(location.search);
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

  if (dateValue) {
    if (start) {
      const d = new Date(start);
      dateValue.textContent = d.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      });
    } else {
      dateValue.textContent = t("lobby.dateUnknown", "未設定");
    }
  }

  if (limitValue) {
    limitValue.textContent = limit || t("lobby.limitUnknown", "未設定");
  }

  if (urlValue) {
    if (target) {
      urlValue.textContent = target;
      urlValue.href = target;
    } else {
      urlValue.textContent = t("lobby.urlUnknown", "未設定");
      urlValue.href = "#";
    }
  }

  if (eventTypeValue) {
    if (eventType === "free") {
      eventTypeValue.textContent = t(
        "lobby.eventTypeFree",
        "無料イベント"
      );
    } else if (eventType === "paid") {
      eventTypeValue.textContent = t("lobby.eventTypePaid", "有料イベント");
    } else {
      eventTypeValue.textContent = t("lobby.eventTypeUnknown", "不明");
    }
  }

  if (priceValue) {
    if (price) {
      priceValue.textContent = price;
    } else {
      priceValue.textContent = "-";
    }
  }

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
          "lobby.statusOngoing",
          "ツアー中です。途中参加も可能です。"
        );
        requestAnimationFrame(update);
        return;
      }

      $("#count").textContent = t(
        "lobby.statusExpired",
        "この待合室は終了しました"
      );
      $("#status").textContent = t(
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
      user = newName.trim().slice(0, 32) || "Guest";
      try {
        localStorage.setItem("nickname", user);
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

  const chatLog = $("#chatLog");

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

  function addSys(text) {
    const div = document.createElement("div");
    div.className = "msg sys";
    div.innerHTML = linkify(text);
    chatLog.appendChild(div);
    chatLog.scrollTop = chatLog.scrollHeight;
  }

  // ★ Reginald「考え中」インジケーター
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
              if (data.id) cleanupPeer(data.id);
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
          logDebug("onmessage JSON parse error: " + e?.message);
        }
      };
    } catch (e) {
      chatStatus.textContent = t(
        "lobby.chatConnectFailed",
        "接続に失敗しました"
      );
      logDebug("connect error: " + e?.message);
    }
  }
  connect();

  chatSend.onclick = () => {
    const tval = (chatInput.value || "").trim();
    if (!tval || !ws || ws.readyState !== 1) return;
    ws.send(tval);
    chatInput.value = "";
    showThinking();
  };
  chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      chatSend.click();
    }
  });

  // ===== WebRTC 音声通話（簡易版） =====
  let localStream = null;
  const peers = new Map();
  const audios = new Map();

  async function getLocalStream() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
      return localStream;
    } catch (e) {
      alert(
        t(
          "lobby.micDenied",
          "マイクへのアクセスが拒否されたか、利用できません。"
        )
      );
      throw e;
    }
  }

  function createPeer(peerId, polite) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (ev) => {
      if (ev.candidate && ws && ws.readyState === 1) {
        ws.send(
          JSON.stringify({
            rtc: {
              to: peerId,
              candidate: ev.candidate,
            },
          })
        );
      }
    };

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
      bindRemoteToVoiceUI();
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        pc.restartIce();
      }
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "closed"
      ) {
        cleanupPeer(peerId);
      }
      bindRemoteToVoiceUI();
    };

    peers.set(peerId, pc);
    return pc;
  }

  function cleanupPeer(peerId) {
    const pc = peers.get(peerId);
    if (pc) {
      pc.close();
      peers.delete(peerId);
    }
    const el = audios.get(peerId);
    if (el) {
      el.srcObject = null;
      el.remove();
      audios.delete(peerId);
    }
    bindRemoteToVoiceUI();
  }

  async function startCalls(members) {
    if (!localStream) return;
    const others = members.filter((m) => m.id !== myId);
    for (const m of others) {
      if (!peers.has(m.id)) {
        const pc = createPeer(m.id, true);
        localStream.getTracks().forEach((track) =>
          pc.addTrack(track, localStream)
        );
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        if (ws && ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              rtc: {
                to: m.id,
                description: pc.localDescription,
              },
            })
          );
        }
      }
    }
    bindRemoteToVoiceUI();
  }

  async function handleRTC(from, rtc) {
    let pc = peers.get(from);
    if (!pc) {
      pc = createPeer(from, false);
    }

    if (rtc.description) {
      const desc = rtc.description;
      const polite = desc.type === "offer";
      if (!localStream) {
        try {
          await getLocalStream();
          localStream.getTracks().forEach((track) =>
            pc.addTrack(track, localStream)
          );
        } catch (e) {
          console.error(e);
          return;
        }
      }

      try {
        const currentSignalingState = pc.signalingState;
        const isStable =
          currentSignalingState === "stable" ||
          currentSignalingState === "have-local-offer";
        if (!polite && !isStable) {
          return;
        }

        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          if (ws && ws.readyState === 1) {
            ws.send(
              JSON.stringify({
                rtc: {
                  to: from,
                  description: pc.localDescription,
                },
              })
            );
          }
        }
      } catch (e) {
        console.error("handleRTC error", e);
      }
    } else if (rtc.candidate) {
      try {
        await pc.addIceCandidate(rtc.candidate);
      } catch (e) {
        console.error("addIceCandidate error", e);
      }
    }
  }

  // ===== 音声UI =====
  const voicePowerBtn = $("#voicePower");
  const micToggleBtn = $("#micToggle");
  const voiceHint = $("#voiceHint");

  let voiceEnabled = false;
  let micMuted = false;

  function bindRemoteToVoiceUI() {
    const remoteCount = peers.size;
    if (!voiceHint) return;
    if (!voiceEnabled) {
      voiceHint.textContent = t("lobby.voiceHintOff", "音声: 未参加");
    } else if (remoteCount === 0) {
      voiceHint.textContent = t(
        "lobby.voiceHintAlone",
        "音声: あなたのみ（他の参加者はいません）"
      );
    } else {
      voiceHint.textContent = t(
        "lobby.voiceHintOn",
        `音声: 接続中（他の参加者 ${remoteCount} 名）`
      );
    }
  }

  function updateVoiceUI() {
    if (voicePowerBtn) {
      voicePowerBtn.textContent = voiceEnabled
        ? t("lobby.voicePowerOn", "音声OFF")
        : t("lobby.voicePowerOff", "音声ON");
      voicePowerBtn.classList.toggle("active", voiceEnabled);
    }
    if (micToggleBtn) {
      micToggleBtn.textContent = micMuted
        ? t("lobby.micToggleUnmute", "ミュート解除")
        : t("lobby.micToggleMute", "ミュート");
      micToggleBtn.style.display = voiceEnabled ? "inline-block" : "none";
    }
    bindRemoteToVoiceUI();
  }

  if (voicePowerBtn) {
    voicePowerBtn.addEventListener("click", async () => {
      if (!voiceEnabled) {
        try {
          await getLocalStream();
          voiceEnabled = true;
          rosterMembers && startCalls(rosterMembers);
        } catch (e) {
          console.error(e);
          return;
        }
      } else {
        voiceEnabled = false;
        for (const id of Array.from(peers.keys())) {
          cleanupPeer(id);
        }
      }
      updateVoiceUI();
    });
  }

  if (micToggleBtn) {
    micToggleBtn.addEventListener("click", () => {
      if (!localStream) return;
      micMuted = !micMuted;
      localStream.getAudioTracks().forEach((track) => {
        track.enabled = !micMuted;
      });
      updateVoiceUI();
    });
  }

  // ===== スマホ用「タップで音を有効化」ボタン =====
  const enableSoundBtn = $("#enableSound");

  function setupMobileAudioGate() {
    if (!enableSoundBtn) return;
    const ua = navigator.userAgent || "";
    const isMobile =
      /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini/i.test(
        ua
      );
    if (!isMobile) {
      enableSoundBtn.style.display = "none";
      return;
    }

    function maybeShowEnableButton() {
      let hasRemote = false;
      for (const el of audios.values()) {
        if (el) {
          hasRemote = true;
          break;
        }
      }
      enableSoundBtn.style.display = hasRemote ? "block" : "none";
    }

    enableSoundBtn.addEventListener("click", async () => {
      for (const el of audios.values()) {
        try {
          await el.play();
        } catch (e) {}
      }
      enableSoundBtn.style.display = "none";
    });

    const retry = () => {
      maybeShowEnableButton();
    };
    document.addEventListener("click", retry);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) maybeShowEnableButton();
    });
  }
  setupMobileAudioGate();

  // 初期状態メッセージ（接続前）
  chatStatus.textContent = t("lobby.chatInitial", "接続していません");
  updateVoiceUI();

  // ========= 「執事に質問（音声）」 音声質問（PC/スマホ: Web Speech / Quest: Workers STT） =========
  const voiceAskBtn = $("#voiceAskBtn");
  const voiceAskStatus = $("#voiceAskStatus");

  const ua2 = navigator.userAgent || "";
  const isQuest =
    /OculusBrowser|Meta Quest|Quest 2|Quest 3/i.test(ua2);

  let recognition = null;
  let recognizing = false;
  let gotResult = false;

  // ---- Workers STT 用の設定（Quest 向けフォールバック） ----
  const STT_ENDPOINT = "https://do-stt.awachima7.workers.dev/stt";

  async function runWorkersSTT() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      voiceAskStatus.textContent = t(
        "lobby.voiceAskNotSupported",
        "お使いのブラウザでは音声での質問機能はご利用いただけません。"
      );
      return;
    }

    voiceAskBtn.classList.add("active");
    voiceAskStatus.textContent = t(
      "lobby.voiceAskRecording",
      "お話しください（もう一度ボタンを押すと終了します）"
    );

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (e) {
      console.error("Quest STT getUserMedia error", e);
      voiceAskBtn.classList.remove("active");
      voiceAskStatus.textContent = t(
        "lobby.micDenied",
        "マイクへのアクセスが拒否されたか、利用できません。"
      );
      return;
    }

    return new Promise((resolve) => {
      const chunks = [];
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });

      let stopped = false;

      const stopAll = () => {
        if (stopped) return;
        stopped = true;
        try {
          recorder.stop();
        } catch {}
        stream.getTracks().forEach((tr) => tr.stop());
      };

      const finish = async () => {
        voiceAskBtn.classList.remove("active");

        const blob = new Blob(chunks, { type: "audio/webm" });
        if (blob.size === 0) {
          voiceAskStatus.textContent = t(
            "lobby.voiceAskTooShort",
            "音声が短すぎるか、認識できませんでした。"
          );
          resolve();
          return;
        }

        voiceAskStatus.textContent = t(
          "lobby.voiceAskSending",
          "音声を解析しています…"
        );

        try {
          const res = await fetch(STT_ENDPOINT, {
            method: "POST",
            body: blob,
            headers: {
              "content-type": "audio/webm",
            },
          });

          const textJson = await res.json().catch(() => ({}));
          const recognized =
            textJson.text ||
            textJson.result ||
            textJson.transcript ||
            "";

          const finalText = (recognized || "").trim();
          if (!finalText) {
            voiceAskStatus.textContent = t(
              "lobby.voiceAskNoText",
              "音声が認識できませんでした。もう一度お試しください。"
            );
            resolve();
            return;
          }

          chatInput.value = finalText;
          chatSend.click();
          voiceAskStatus.textContent = t(
            "lobby.voiceAskSent",
            "音声でのご質問を送信しました。"
          );
        } catch (e) {
          console.error("Quest STT fetch error", e);
          voiceAskStatus.textContent = t(
            "lobby.voiceAskError",
            "音声認識中にエラーが発生しました。"
          );
        } finally {
          resolve();
        }
      };

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) {
          chunks.push(ev.data);
        }
      };
      recorder.onerror = (ev) => {
        console.error("MediaRecorder error", ev.error || ev);
        voiceAskStatus.textContent = t(
          "lobby.voiceAskError",
          "音声認識中にエラーが発生しました。"
        );
      };
      recorder.onstop = finish;

      recorder.start();

      // ボタンをもう一度押したら録音終了
      const onClickStop = (e) => {
        e.preventDefault();
        voiceAskBtn.removeEventListener("click", onClickStop);
        stopAll();
      };
      voiceAskBtn.addEventListener("click", onClickStop);
    });
  }

  function setupVoiceAsk() {
    if (!voiceAskBtn || !voiceAskStatus) return;

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

    // ---- PC/スマホ: Web Speech API （押している間だけ録音）----
    if (SR && !isQuest) {
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
          "お話しください（ボタンを押している間だけ録音されます）"
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

      voiceAskBtn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        startRec();
      });
      voiceAskBtn.addEventListener("pointerup", (e) => {
        e.preventDefault();
        stopRec();
      });
      voiceAskBtn.addEventListener("pointerleave", (e) => {
        e.preventDefault();
        stopRec();
      });

      return;
    }

    // ---- Quest ブラウザ: Workers STT フォールバック ----
    if (isQuest) {
      voiceAskBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        if (voiceAskBtn.classList.contains("active")) {
          // 録音中は runWorkersSTT 内の click ハンドラが処理する
          return;
        }
        await runWorkersSTT();
      });
      return;
    }

    // ---- それ以外のブラウザで Web Speech もない場合 ----
    voiceAskBtn.style.display = "none";
    voiceAskStatus.textContent = t(
      "lobby.voiceAskNotSupported",
      "お使いのブラウザでは音声での質問機能はご利用いただけません。"
    );
  }

  setupVoiceAsk();
})();
