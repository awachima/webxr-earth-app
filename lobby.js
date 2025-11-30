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
let currentLang  = langParam || storedLang || (navigator.language || "ja").slice(0, 2) || "ja";

if (!["en", "ja", "zh", "fa", "hi", "he"].includes(currentLang)) {
  currentLang = "ja";
}

document.documentElement.lang = currentLang;
document.documentElement.dir  = (currentLang === "fa" || currentLang === "he") ? "rtl" : "ltr";

// ===== i18n ロード =====
const LOBBY_LANG_FILES = {
  en: "./lang/lobby-en.json",
  ja: "./lang/lobby-ja.json",
  zh: "./lang/lobby-zh.json",
  fa: "./lang/lobby-fa.json",
  hi: "./lang/lobby-hi.json",
  he: "./lang/lobby-he.json"
};

let i18nLobby = null;

async function loadLobbyLanguage(lang) {
  const url = LOBBY_LANG_FILES[lang] || LOBBY_LANG_FILES["ja"];
  if (!url) return;
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    i18nLobby = await res.json();
  } catch (e) {
    console.warn("Failed to load lobby i18n", e);
  }
}

function t(keyPath, fallback) {
  if (!i18nLobby) return fallback;
  const parts = keyPath.split(".");
  let cur = i18nLobby;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) {
      cur = cur[p];
    } else {
      return fallback;
    }
  }
  return typeof cur === "string" ? cur : fallback;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function linkify(text) {
  if (!text) return "";
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  return text.replace(urlRegex, (url) => {
    const safeUrl = url.replace(/"/g, "&quot;");
    return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeUrl}</a>`;
  });
}

function formatFeeLabelFromParams(feeType, feeAmount){
  const type = feeType || 'free';
  const amount = (feeAmount || '').trim();
  const lang = (window.currentLang || document.documentElement.lang || 'en').toLowerCase();
  const isJa = lang.startsWith('ja');
  if (type === 'paid'){
    if (isJa){
      return amount ? `有料イベント（${amount}円）` : '有料イベント';
    } else {
      return amount ? `Paid event (${amount})` : 'Paid event';
    }
  } else {
    return isJa ? '無料イベント' : 'Free event';
  }
}

// ===== メイン初期化（i18n 読み込み後に実行） =====
(async function initLobby() {
  await loadLobbyLanguage(currentLang);

  const titleParam  = urlParams.get("title") || "待ち合わせ";
  const startParam  = urlParams.get("start");
  const limitParam  = parseInt(urlParams.get("limit") || "10", 10);
  const targetParam = urlParams.get("target") || "";
  const roomId      = urlParams.get("roomId") || "";
  const feeTypeParam   = urlParams.get("feeType") || "free";
  const feeAmountParam = urlParams.get("feeAmount") || "";

  const storedNick  = localStorage.getItem("nickname");
  const user        = storedNick || `Guest-${Math.random().toString(16).slice(2, 6)}`;
  const isMobile    = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
  const isIOS       = /iPhone|iPad|iPod/i.test(navigator.userAgent);

  // タイトル・meta
  $("#title").textContent = titleParam;
  document.title = titleParam + " | " + t("lobby.pageTitleSuffix", "待ち合わせロビー");

  let startDate = null;
  const startLabel = t("lobby.startLabel", "開始時刻：");
  let baseMeta = "";
  if (startParam) {
    startDate = new Date(startParam);
    baseMeta = startLabel + startDate.toLocaleString();
  } else {
    baseMeta = startLabel + "—";
  }
  const feeText = formatFeeLabelFromParams(feeTypeParam, feeAmountParam);
  if (feeText) {
    $("#meta").textContent = `${baseMeta}   ${feeText}`;
  } else {
    $("#meta").textContent = baseMeta;
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
    enterBtn.disabled = false;
    enterBtn.onclick = () => {
      location.href = targetParam;
    };
    $("#statusNote").innerHTML = t(
      "lobby.statusNoteValid",
      "※ボタンを押すと Dokodemo Doors のツアー／ワールドページに移動します。"
    );
  } else {
    enterBtn.disabled = true;
    $("#statusNote").innerHTML = t(
      "lobby.statusNoteInvalid",
      "有効なツアー／ワールド URL が設定されていません。"
    );
  }

  // カウントダウン
  const countEl = $("#count");
  const statusEl = $("#status");

  function tick() {
    if (!startDate) {
      countEl.textContent = "--:--:--";
      statusEl.textContent = t("lobby.statusNoTime", "開始時刻が設定されていません。");
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
      $("#count").textContent = t("lobby.statusStartedShort", "開始しました");
      $("#status").textContent = t(
        "lobby.statusStartedDetail",
        "動画ページに移動して、ツアー／ワールドにご参加ください。"
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

  // URL コピー
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
      alert(msg + " " + url);
    }
  };

  // 名前変更
  $("#setName").onclick = () => {
    const placeholder = t("lobby.namePromptPlaceholder", "表示名を入力してください");
    const newName = prompt(placeholder, user);
    if (newName && newName.trim()) {
      localStorage.setItem("nickname", newName.trim());
      location.reload();
    }
  };

  // チャット
  const messagesEl = $("#messages");
  const inputEl    = $("#messageInput");
  const sendBtn    = $("#sendBtn");
  const botToggle  = $("#botToggle");

  function appendMessage(author, text, isSystem = false) {
    const div = document.createElement("div");
    div.className = "message";
    const nameSpan = document.createElement("span");
    nameSpan.className = "author";
    nameSpan.textContent = author + "：";
    const bodySpan = document.createElement("span");
    bodySpan.className = "body";
    bodySpan.innerHTML = isSystem ? text : linkify(text);
    div.appendChild(nameSpan);
    div.appendChild(bodySpan);
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  appendMessage("システム", t("lobby.systemWelcome", "この待ち合わせロビーへようこそ。"));

  function sendUserMessage() {
    const text = inputEl.value.trim();
    if (!text) return;
    appendMessage(user, text);
    inputEl.value = "";
    if (botToggle.checked) {
      const reply = t("lobby.botEchoPrefix", "ロボ：") + text;
      setTimeout(() => appendMessage("ロボ", reply), 500);
    }
  }

  sendBtn.onclick = sendUserMessage;
  inputEl.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.isComposing) {
      ev.preventDefault();
      sendUserMessage();
    }
  });

  // デバッグ情報
  $("#debug").textContent = JSON.stringify(
    {
      title: titleParam,
      start: startParam,
      limit: limitParam,
      target: targetParam,
      roomId,
      feeType: feeTypeParam,
      feeAmount: feeAmountParam,
      user,
      isMobile,
      isIOS,
      lang: currentLang
    },
    null,
    2
  );
})();
