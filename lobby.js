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
  if (owners[roomId]) {
    delete owners[roomId];
    writeOwners(owners);
  }
}

// ===== 翻訳ヘルパー =====
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

function formatFeeLabelForLobby(feeType, feeAmount) {
  const type = feeType || "free";
  const amount = (feeAmount || "").trim();
  const lang = (window.currentLang || document.documentElement.lang || "ja").toLowerCase();
  const isJa = lang.startsWith("ja");
  if (type === "paid") {
    if (isJa) {
      return amount ? `有料イベント（${amount}円）` : "有料イベント";
    }
    return amount ? `Paid event (${amount})` : "Paid event";
  }
  return isJa ? "無料イベント" : "Free event";
}

function applyLobbyTexts() {
  const root = window.i18n || {};
  const l = root.lobby || {};

  const headerTitle = document.querySelector("#lobbyHeaderTitle");
  if (headerTitle && l.headerTitle) headerTitle.textContent = l.headerTitle;

  const enterBtn = document.querySelector("#enter");
  if (enterBtn && l.enterBtn) enterBtn.textContent = l.enterBtn;

  const copyBtn = document.querySelector("#copyUrl");
  if (copyBtn && l.copyUrlBtn) copyBtn.textContent = l.copyUrlBtn;

  const helpText = document.querySelector("#helpText");
  if (helpText && l.helpTextHtml) helpText.innerHTML = l.helpTextHtml;

  const logTitle = document.querySelector("#logTitle");
  if (logTitle && l.logTitle) logTitle.textContent = l.logTitle;

  const sysTitle = document.querySelector("#systemTitle");
  if (sysTitle && l.systemTitle) sysTitle.textContent = l.systemTitle;
}

// ===== URL パラメータ =====
const urlParams = new URLSearchParams(location.search);

// ===== i18n 読み込み =====
let currentLang = urlParams.get("lang") || localStorage.getItem("lang") || "ja";
window.currentLang = currentLang;

async function loadLobbyLanguage(lang) {
  try {
    const res = await fetch(`./lang/${lang}.json`);
    if (!res.ok) return;
    const data = await res.json();
    window.i18n = data;
    applyLobbyTexts();
  } catch (e) {}
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
  if (startParam) {
    startDate = new Date(startParam);
  }

  let metaText = t("lobby.startLabel", "開始時刻：") + (startDate ? startDate.toLocaleString() : "—");
  const feeLabel = formatFeeLabelForLobby(feeTypeParam, feeAmountParam);
  if (feeLabel) {
    metaText += "　" + feeLabel; // 全角スペースで少し余白を空ける
  }
  $("#meta").textContent = metaText;

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
  if (enterBtn) {
    if (validTarget) {
      enterBtn.disabled = false;
      enterBtn.addEventListener("click", () => {
        if (/OculusBrowser|Meta Quest/i.test(navigator.userAgent)) {
          location.href = targetParam;
        } else {
          window.open(targetParam, "_blank", "noopener,noreferrer");
        }
      });
    } else {
      enterBtn.disabled = true;
    }
  }

  const urlBox = $("#roomUrl");
  if (urlBox) {
    urlBox.value = location.href;
  }

  const copyBtn = $("#copyUrl");
  if (copyBtn && navigator.clipboard) {
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(location.href);
        alert(t("lobby.copied", "URL をコピーしました。"));
      } catch (e) {
        alert(t("lobby.copyFailed", "コピーに失敗しました。"));
      }
    });
  }

  // デバッグ用 JSON 表示
  const debugJSON = JSON.stringify(
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

  const debugEl = $("#debug");
  if (debugEl) {
    debugEl.textContent = debugJSON;
  }

  // ニックネーム設定
  $("#setName").onclick = function setNickname() {
    const current = localStorage.getItem("nickname") || user;
    const name = prompt(t("lobby.nicknamePrompt", "ニックネームを入力してください"), current);
    if (!name) return;
    localStorage.setItem("nickname", name);
    location.reload();
  };
})();
