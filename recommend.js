/* recommend.js - リロードで完全リセット & 自動挨拶版 */

const WORKER_URL = "https://lucy-worker.dokodemodoors.workers.dev/chat"; // ★あなたのWorkerのURLに合わせてください

// 現在の状態（メモリ上のみで管理し、リロードで消える）
let currentState = {
    step: "S0",
    turnCount: 0,
    lastPatternIndex: 0,
    history: []
};

// DOM要素
const chatWindow = document.getElementById('chat-window');
const userInput = document.getElementById('user-input');
const sendBtn = document.getElementById('send-btn');
const loading = document.getElementById('loading');

// 初期化：ページ読み込み時に必ずS0（挨拶）から開始
window.addEventListener('load', () => {
    // 念のためセッションストレージもクリアしておく（以前のキャッシュ対策）
    sessionStorage.removeItem('lucyState');
    
    // UIをクリア
    chatWindow.innerHTML = '';
    
    // 初回挨拶をWorkerに要求
    callWorker(null, "S0"); 
});

// 送信ボタンクリック
sendBtn.addEventListener('click', () => {
    handleUserSubmit();
});

// Enterキー対応
userInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        handleUserSubmit();
    }
});

// ユーザー入力処理
function handleUserSubmit() {
    const text = userInput.value.trim();
    if (!text) return;

    // ユーザーの吹き出しを表示
    addMessage(text, 'user');
    userInput.value = '';

    // Workerへ送信
    callWorker(text);
}

// Worker呼び出し
async function callWorker(text, forceStep = null) {
    showLoading(true);

    try {
        // もし強制ステップ指定があれば適用（初回S0用）
        if (forceStep) {
            currentState.step = forceStep;
        }

        const payload = {
            userText: text,
            state: currentState
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
                currentState = data.nextState;
            }
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

// メッセージを画面に追加
function addMessage(text, sender) {
    const div = document.createElement('div');
    div.classList.add('message', sender);
    
    // HTMLタグ（リンクなど）を有効にするため innerHTML を使用
    // ※ユーザー入力は危険回避のため textContent 推奨だが、
    // 今回は簡易チャットなので、Lucy側はHTML許可、User側はエスケープするのが安全。
    // ここではシンプルに innerHTML で統一していますが、本番環境ではサニタイズ推奨。
    
    // 改行コードを <br> に変換
    const formattedText = text.replace(/\n/g, '<br>');
    div.innerHTML = formattedText;

    chatWindow.appendChild(div);
    scrollToBottom();
    
    // 履歴に追加（Workerとの同期用）
    // ※Worker側で履歴管理しているので、クライアント側では送受信時にstate.historyが更新されて戻ってくる
}

// ローディング表示切り替え
function showLoading(show) {
    loading.style.display = show ? 'block' : 'none';
    if (show) scrollToBottom();
}

// 最下部へスクロール
function scrollToBottom() {
    chatWindow.scrollTop = chatWindow.scrollHeight;
}