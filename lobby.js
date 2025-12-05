  // ===== Web Speech API による執事への音声質問 =====
  function setupVoiceAsk() {
    const voiceAskBtn = $("#voiceAskBtn");
    const voiceAskLabel = $("#voiceAskLabel");
    const chatInput = $("#chatInput");
    if (!voiceAskBtn || !chatInput) return;

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (voiceAskLabel) {
        voiceAskLabel.textContent = t(
          "lobby.voiceAskNotSupported",
          "このブラウザでは音声認識は利用できません。"
        );
      }
      voiceAskBtn.disabled = true;
      return;
    }

    const recognition = new SpeechRecognition();
    // 現在の表示言語をもとに認識言語を決定
    recognition.lang = currentLang || detectLang();
    recognition.interimResults = false;
    recognition.continuous = false;

    let recognizing = false;
    let finalTranscript = "";

    function updateUI() {
      if (!voiceAskBtn || !voiceAskLabel) return;
      if (recognizing) {
        voiceAskBtn.textContent = t(
          "lobby.voiceAskBtnRecording",
          "録音停止"
        );
        voiceAskLabel.textContent = t(
          "lobby.voiceAskRecording",
          "お話しください（もう一度ボタンを押すと終了します）"
        );
      } else {
        voiceAskBtn.textContent = t(
          "lobby.voiceAskBtn",
          "執事に質問（音声）"
        );
        voiceAskLabel.textContent = t(
          "lobby.voiceAskLabel",
          "執事に質問（音声）"
        );
      }
    }

    recognition.onstart = () => {
      recognizing = true;
      finalTranscript = "";
      updateUI();
    };

    recognition.onresult = (event) => {
      let text = "";
      for (let i = 0; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) text += res[0].transcript;
      }
      finalTranscript = text.trim();
    };

    recognition.onerror = (event) => {
      console.warn("speech error", event.error);
      recognizing = false;
      updateUI();
    };

    recognition.onend = () => {
      const wasRecognizing = recognizing;
      recognizing = false;
      updateUI();

      if (!finalTranscript) {
        if (wasRecognizing) {
          addSys(
            t(
              "lobby.voiceAskTooShort",
              "音声が短すぎたか、認識できませんでした。"
            )
          );
        }
        return;
      }

      // 認識結果をテキスト欄に入れて、そのまま送信
      chatInput.value = finalTranscript;
      chatSend.click();
    };

    function toggleRec() {
      if (!recognition) return;
      try {
        if (recognizing) {
          recognition.stop();
        } else {
          recognition.start();
        }
      } catch (e) {
        console.warn("speech start/stop error", e);
      }
    }

    // ★ クリックで開始／停止をトグル
    voiceAskBtn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleRec();
    });

    updateUI();
  }

  // 初期化
  setupVoiceAsk();
