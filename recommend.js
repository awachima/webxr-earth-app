/* recommend.js - リロードでリセット＆初回挨拶版 */

const WORKER_URL = "https://lucy-recommend.awachima7.workers.dev/chat";

// 状態管理（リロードで初期化されます）
let state = {
  step: "S0",
  turnCount: 0,
  lastPatternIndex: 0,
  history: [], // 会話履歴
};

// DOM要素の取得
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const loading = document.getElementById('loading'); 

// ---------------------------------------------------------
// 初期化：ページ読み込み時に必ずS0（挨拶）から開始
// ---------------------------------------------------------
window.addEventListener('load', () => {
  // ★修正ポイント: 前回の会話を復元する処理（loadState）を削除しました。
  
  // 念のためセッションストレージに残っている古いデータも消去
  sessionStorage.removeItem('lucy_chat_state');
  sessionStorage.removeItem('lucy_chat_html');

  // 画面をクリア
  if (chatWindow) chatWindow.innerHTML = '';
  
  // 初回挨拶をWorkerに要求 (S0)
  callWorker("", "S0");
});

// ---------------------------------------------------------
// イベントリスナー
// ---------------------------------------------------------
if (sendBtn) {
  sendBtn.addEventListener('click', handleUserSubmit);
}

if (userInput) {
  userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleUserSubmit();
  });
}

function handleUserSubmit() {
  if (!userInput) return;
  const text = userInput.value.trim();
  if (!text) return;

  // 自分の発言を表示
  addMessage(text, 'user');
  userInput.value = '';

  // Workerへ送信
  callWorker(text);
}

// ---------------------------------------------------------
// Worker通信処理
// ---------------------------------------------------------
async function callWorker(text, forceStep = null) {
  showLoading(true);

  try {
    // 初回強制ステップ指定があれば適用
    if (forceStep) {
      state.step = forceStep;
    }

    const payload = {
      userText: text,
      state: state
    };

    const res = await fetch(WORKER_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      throw new Error(`Server error: ${res.status}`);
    }

    const data = await res.json();

    if (data.ok) {
      // Lucyの返答を表示
      if (data.reply) {
        addMessage(data.reply, 'lucy');
      }

      // 状態を更新
      if (data.nextState) {
        state = data.nextState;
      }
      
      // ★修正ポイント: ここにあった saveState() を削除しました。
    } else {
      console.error("Worker error:", data.error);
      addMessage("すみません、エラーが発生しました。", 'lucy');
    }

  } catch (err) {
    console.error("Fetch error:", err);
    addMessage("通信エラーが発生しました。", 'lucy');
  } finally {
    showLoading(false);
  }
}

// ---------------------------------------------------------
// 画面表示ヘルパー
// ---------------------------------------------------------
function addMessage(text, sender) {
  if (!chatWindow) return;

  const div = document.createElement('div');
  div.classList.add('message', sender);
  
  // 改行を <br> に変換してHTMLとして挿入
  const formattedText = text.replace(/\n/g, '<br>');
  div.innerHTML = formattedText;

  chatWindow.appendChild(div);
  scrollToBottom();
  
  // ★修正ポイント: ここにあった saveState() を削除しました。
}

function showLoading(show) {
  if (!loading) return;
  loading.style.display = show ? 'block' : 'none';
  if (show) scrollToBottom();
}

function scrollToBottom() {
  if (!chatWindow) return;
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// ★修正ポイント: saveState, loadState 関数自体を削除しました。