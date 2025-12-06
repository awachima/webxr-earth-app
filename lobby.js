// ===== 共通ヘルパー・定数 =====
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const byId = (id) => document.getElementById(id);

// ===== URL パラメータ取得 =====
const urlParams = new URLSearchParams(window.location.search);
const roomId = urlParams.get("roomId") || urlParams.get("roomid") || urlParams.get("room") || "default";
const title = urlParams.get("title") || "Untitled";
const start = urlParams.get("start") || "";
const limit = urlParams.get("limit") || "";
const target = urlParams.get("target") || "";
const targetDecoded = target ? decodeURIComponent(target) : "";
const startTime = start ? new Date(start) : null;

// ===== ローカルストレージ用キー =====
const LS_KEY_NICKNAME = "dokodemo_nickname";
const LS_KEY_LANG = "dokodemo_lang";
const LS_KEY_VOICE_AUTO_JOIN = "dokodemo_voice_auto_join";
const LS_KEY_VOICE_ECHO_SELF = "dokodemo_voice_echo_self";

// ===== 多言語対応 =====
// lang パラメータまたはローカルストレージの設定から現在言語を決定
const urlLangParam = urlParams.get("lang");
const storedLang = localStorage.getItem(LS_KEY_LANG);
let currentLang = urlLangParam || storedLang || "ja";

// 有効な言語かどうかチェック
const validLangs = ["en", "ja", "zh", "fa", "hi", "he"];
if (!validLangs.includes(currentLang)) {
  currentLang = "ja";
}
localStorage.setItem(LS_KEY_LANG, currentLang);

// 言語別の文言定義
const messagesByLang = {
  ja: {
    pageTitle: "待ち合わせロビー",
    siteName: "どこでもドア ファンサイト",
    backToTop: "戻る",
    changeNickname: "ニックネーム",
    roomTitleLabel: "テスト",
    countdownLabel: "カウントダウン",
    countdownDesc: "開始までお待ちください。",
    goTourButton: "ツアーに行く",
    copyRoomUrlButton: "この待合室のURLをコピー",
    participantsLabel: "参加者",
    // ここを修正済み: 「ボイスチャット」→「参加者」
    voiceChatLabel: "参加者",
    voiceOnButton: "音声ON",
    voiceOffButton: "音声OFF",
    voiceHintShort: "音声ON/OFFを切り替えると改善する場合があります。",
    voiceHintDetail:
      "※ 音声はブラウザ同士で直接やり取りされます。声はON/OFFで改善することがあります。ゆっくり・はっきり話すと認識が安定します。",
    chatLabel: "テキストチャット",
    sendButton: "送信",
    askButlerButton: "執事に質問（音声）",
    askButlerHint: "執事への質問は10秒程度の短い文章でお願いします。",
    nicknameDialogTitle: "ニックネーム",
    nicknameDialogDesc: "この待合室で使用するニックネームを入力してください。",
    nicknameDialogPlaceholder: "ニックネーム",
    nicknameDialogOk: "OK",
    nicknameDialogCancel: "キャンセル",
    toastCopied: "コピーしました。",
    toastCopyFailed: "コピーに失敗しました。",
    toastVoicePermissionDenied:
      "マイクの使用が許可されていません。ブラウザの設定を確認してください。",
    toastVoiceNotSupported:
      "このブラウザでは音声録音がサポートされていません。",
    toastVoiceRecordingStarted: "録音を開始しました。話し終えたらボタンを離してください。",
    toastVoiceRecordingStopped: "録音を終了しました。音声を送信しています…",
    toastVoiceApiError: "音声認識に失敗しました。",
    toastVoiceEmptyResult: "音声を認識できませんでした。もう一度お試しください。",
    toastVoiceAskSent: "執事への音声質問を送信しました。",
    toastNicknameRequired: "ニックネームを入力してください。",
    toastNicknameSaved: "ニックネームを保存しました。",
    toastRoomUrlCopied: "待合室のURLをコピーしました。",
    toastRoomUrlCopyFailed: "待合室のURLのコピーに失敗しました。",
    toastWebSocketDisconnected: "サーバーとの接続が切断されました。",
    toastWebSocketReconnected: "サーバーに再接続しました。",
    toastRoomLimitReached: "参加上限に達しているため入室できません。",
    toastRoomNotStarted: "まだ開始時刻になっていません。",
    toastRoomExpired: "この待合室の有効期限は終了しました。",
    toastUnknownError: "不明なエラーが発生しました。",
    chatPlaceholder: "メッセージを入力...",
    rosterLabel: "参加者一覧",
    rosterYou: "（自分）",
    rosterIdPrefix: "ID: ",
    rosterNone: "参加者はいません。",
    startInfoLabel: "開始日時",
    startInfoUnknown: "不明",
    limitInfoLabel: "参加上限",
    limitInfoUnknown: "不明",
    eventTypeFree: "無料イベント",
    eventTypePaid: "有料イベント",
    eventTypeUnknown: "種別：不明",
    priceLabel: "料金",
    priceUnknown: "料金：不明",
    autoSettingsLabel: "音声・会話設定",
    autoEchoSelfLabel: "自分の声を自分にも流す",
    autoJoinLabel: "入室時に自動で音声接続する",
    rosterCountLabel: "現在の参加者数",
  },
  en: {
    pageTitle: "Waiting Lobby",
    siteName: "DokodemoDoors Fan Site",
    backToTop: "Back",
    changeNickname: "Nickname",
    roomTitleLabel: "Test",
    countdownLabel: "Countdown",
    countdownDesc: "Please wait until the session starts.",
    goTourButton: "Join the tour",
    copyRoomUrlButton: "Copy this room URL",
    participantsLabel: "Participants",
    voiceChatLabel: "Participants",
    voiceOnButton: "Voice ON",
    voiceOffButton: "Voice OFF",
    voiceHintShort: "Toggling Voice ON / OFF may help when you can’t join.",
    voiceHintDetail:
      "Voice is exchanged directly between browsers. If joining fails, please try toggling the voice ON / OFF. Speaking slowly and clearly makes recognition more stable.",
    chatLabel: "Text Chat",
    sendButton: "Send",
    askButlerButton: "Ask the Butler (voice)",
    askButlerHint: "Please keep your spoken question short (about 10 seconds).",
    nicknameDialogTitle: "Nickname",
    nicknameDialogDesc: "Please enter the nickname used in this lobby.",
    nicknameDialogPlaceholder: "Nickname",
    nicknameDialogOk: "OK",
    nicknameDialogCancel: "Cancel",
    toastCopied: "Copied.",
    toastCopyFailed: "Failed to copy.",
    toastVoicePermissionDenied:
      "Microphone access is not allowed. Please check your browser settings.",
    toastVoiceNotSupported:
      "Audio recording is not supported on this browser.",
    toastVoiceRecordingStarted:
      "Recording started. Please release the button once you finish speaking.",
    toastVoiceRecordingStopped:
      "Recording stopped. Sending your voice to the butler...",
    toastVoiceApiError: "Voice recognition failed.",
    toastVoiceEmptyResult:
      "We could not recognize your voice. Please try again.",
    toastVoiceAskSent: "Your voice question has been sent to the butler.",
    toastNicknameRequired: "Please enter a nickname.",
    toastNicknameSaved: "Nickname saved.",
    toastRoomUrlCopied: "Lobby URL copied.",
    toastRoomUrlCopyFailed: "Failed to copy the lobby URL.",
    toastWebSocketDisconnected: "Connection to the server was lost.",
    toastWebSocketReconnected: "Reconnected to the server.",
    toastRoomLimitReached: "The participant limit has been reached.",
    toastRoomNotStarted: "The session has not started yet.",
    toastRoomExpired: "This lobby has already expired.",
    toastUnknownError: "An unknown error occurred.",
    chatPlaceholder: "Type a message...",
    rosterLabel: "Participants",
    rosterYou: " (you)",
    rosterIdPrefix: "ID: ",
    rosterNone: "No participants.",
    startInfoLabel: "Start time",
    startInfoUnknown: "Unknown",
    limitInfoLabel: "Capacity",
    limitInfoUnknown: "Unknown",
    eventTypeFree: "Free event",
    eventTypePaid: "Paid event",
    eventTypeUnknown: "Type: Unknown",
    priceLabel: "Price",
    priceUnknown: "Price: Unknown",
    autoSettingsLabel: "Voice / Conversation settings",
    autoEchoSelfLabel: "Play my own voice back to me",
    autoJoinLabel: "Automatically join voice on entering the room",
    rosterCountLabel: "Current participants",
  },
  zh: {
    pageTitle: "等候大厅",
    siteName: "任何门粉丝网站",
    backToTop: "返回",
    changeNickname: "昵称",
    roomTitleLabel: "测试",
    countdownLabel: "倒计时",
    countdownDesc: "请等待活动开始。",
    goTourButton: "前往游览",
    copyRoomUrlButton: "复制此房间的 URL",
    participantsLabel: "参加者",
    voiceChatLabel: "参加者",
    voiceOnButton: "语音开启",
    voiceOffButton: "语音关闭",
    voiceHintShort: "无法加入语音时，请尝试多次切换语音开关。",
    voiceHintDetail:
      "语音在浏览器之间直接传输。如果无法加入，请多次切换语音开关。说话慢一些、清楚一些会让识别更稳定。",
    chatLabel: "文本聊天",
    sendButton: "发送",
    askButlerButton: "向管家提问（语音）",
    askButlerHint: "请用大约 10 秒的简短句子提问。",
    nicknameDialogTitle: "昵称",
    nicknameDialogDesc: "请输入在此房间中使用的昵称。",
    nicknameDialogPlaceholder: "昵称",
    nicknameDialogOk: "确定",
    nicknameDialogCancel: "取消",
    toastCopied: "已复制。",
    toastCopyFailed: "复制失败。",
    toastVoicePermissionDenied: "未授权使用麦克风。请检查浏览器设置。",
    toastVoiceNotSupported: "当前浏览器不支持录音功能。",
    toastVoiceRecordingStarted: "开始录音。说完后请松开按钮。",
    toastVoiceRecordingStopped: "录音结束，正在发送语音……",
    toastVoiceApiError: "语音识别失败。",
    toastVoiceEmptyResult: "未能识别语音，请重试。",
    toastVoiceAskSent: "已向管家发送语音问题。",
    toastNicknameRequired: "请输入昵称。",
    toastNicknameSaved: "已保存昵称。",
    toastRoomUrlCopied: "已复制房间 URL。",
    toastRoomUrlCopyFailed: "复制房间 URL 失败。",
    toastWebSocketDisconnected: "与服务器的连接已中断。",
    toastWebSocketReconnected: "已重新连接服务器。",
    toastRoomLimitReached: "人数已满，无法进入。",
    toastRoomNotStarted: "尚未到开始时间。",
    toastRoomExpired: "此房间已失效。",
    toastUnknownError: "发生未知错误。",
    chatPlaceholder: "输入消息……",
    rosterLabel: "参加者列表",
    rosterYou: "（本人）",
    rosterIdPrefix: "ID：",
    rosterNone: "暂无参加者。",
    startInfoLabel: "开始时间",
    startInfoUnknown: "未知",
    limitInfoLabel: "参加上限",
    limitInfoUnknown: "未知",
    eventTypeFree: "免费活动",
    eventTypePaid: "收费活动",
    eventTypeUnknown: "类型：未知",
    priceLabel: "费用",
    priceUnknown: "费用：未知",
    autoSettingsLabel: "语音／会话设置",
    autoEchoSelfLabel: "将自己的声音回传给自己",
    autoJoinLabel: "进入房间时自动加入语音",
    rosterCountLabel: "当前参加者人数",
  },
  fa: {
    pageTitle: "لابی انتظار",
    siteName: "سایت هواداران DokodemoDoors",
    backToTop: "بازگشت",
    changeNickname: "نام نمایشی",
    roomTitleLabel: "آزمون",
    countdownLabel: "شمارش معکوس",
    countdownDesc: "لطفاً تا زمان شروع رویداد منتظر بمانید.",
    goTourButton: "رفتن به تور",
    copyRoomUrlButton: "کپی URL این لابی",
    participantsLabel: "شرکت‌کنندگان",
    voiceChatLabel: "شرکت‌کنندگان",
    voiceOnButton: "صدا روشن",
    voiceOffButton: "صدا خاموش",
    voiceHintShort: "اگر به گفت‌وگوی صوتی متصل نمی‌شوید، چند بار صدا را خاموش و روشن کنید.",
    voiceHintDetail:
      "صدا مستقیماً بین مرورگرها رد و بدل می‌شود. در صورت بروز مشکل، چند بار دکمه صدا را خاموش و روشن کنید. صحبت آرام و واضح باعث ثبات بیشتر تشخیص می‌شود.",
    chatLabel: "گفت‌وگوی متنی",
    sendButton: "ارسال",
    askButlerButton: "پرسش از خدمتکار (صوتی)",
    askButlerHint: "لطفاً پرسش خود را در حد حدود ۱۰ ثانیه بیان کنید.",
    nicknameDialogTitle: "نام نمایشی",
    nicknameDialogDesc: "نامی را که می‌خواهید در این لابی نمایش داده شود وارد کنید.",
    nicknameDialogPlaceholder: "نام نمایشی",
    nicknameDialogOk: "تأیید",
    nicknameDialogCancel: "لغو",
    toastCopied: "کپی شد.",
    toastCopyFailed: "کپی انجام نشد.",
    toastVoicePermissionDenied:
      "دسترسی به میکروفون مسدود است. تنظیمات مرورگر خود را بررسی کنید.",
    toastVoiceNotSupported:
      "این مرورگر از ضبط صدا پشتیبانی نمی‌کند.",
    toastVoiceRecordingStarted:
      "ضبط صدا آغاز شد. پس از پایان صحبت، دکمه را رها کنید.",
    toastVoiceRecordingStopped:
      "ضبط پایان یافت. در حال ارسال پرسش صوتی…",
    toastVoiceApiError: "تشخیص صدا با خطا روبه‌رو شد.",
    toastVoiceEmptyResult:
      "صدا قابل تشخیص نبود. لطفاً دوباره تلاش کنید.",
    toastVoiceAskSent: "پرسش صوتی شما برای خدمتکار ارسال شد.",
    toastNicknameRequired: "لطفاً نام نمایشی وارد کنید.",
    toastNicknameSaved: "نام نمایشی ذخیره شد.",
    toastRoomUrlCopied: "URL لابی کپی شد.",
    toastRoomUrlCopyFailed: "کپی URL لابی با خطا روبه‌رو شد.",
    toastWebSocketDisconnected: "ارتباط با سرور قطع شد.",
    toastWebSocketReconnected: "دوباره به سرور متصل شد.",
    toastRoomLimitReached: "ظرفیت این لابی تکمیل شده است.",
    toastRoomNotStarted: "هنوز زمان شروع نرسیده است.",
    toastRoomExpired: "اعتبار این لابی به پایان رسیده است.",
    toastUnknownError: "خطای نامشخص رخ داد.",
    chatPlaceholder: "پیام خود را بنویسید…",
    rosterLabel: "فهرست شرکت‌کنندگان",
    rosterYou: " (خود شما)",
    rosterIdPrefix: "شناسه: ",
    rosterNone: "هیچ شرکت‌کننده‌ای نیست.",
    startInfoLabel: "زمان شروع",
    startInfoUnknown: "نامشخص",
    limitInfoLabel: "حداکثر شرکت‌کننده",
    limitInfoUnknown: "نامشخص",
    eventTypeFree: "رویداد رایگان",
    eventTypePaid: "رویداد پولی",
    eventTypeUnknown: "نوع: نامشخص",
    priceLabel: "هزینه",
    priceUnknown: "هزینه: نامشخص",
    autoSettingsLabel: "تنظیمات صدا و گفت‌وگو",
    autoEchoSelfLabel: "پخش صدای خود برای خودم",
    autoJoinLabel: "هنگام ورود به لابی خودکار به صدا متصل شو",
    rosterCountLabel: "تعداد شرکت‌کنندگان فعلی",
  },
  hi: {
    pageTitle: "वेटिंग लॉबी",
    siteName: "DokodemoDoors फ़ैन साइट",
    backToTop: "वापस",
    changeNickname: "निकनेम",
    roomTitleLabel: "टेस्ट",
    countdownLabel: "काउंटडाउन",
    countdownDesc: "कृपया शुरू होने तक प्रतीक्षा करें।",
    goTourButton: "टूर पर जाएँ",
    copyRoomUrlButton: "इस रूम का URL कॉपी करें",
    participantsLabel: "प्रतिभागी",
    voiceChatLabel: "प्रतिभागी",
    voiceOnButton: "वॉइस ON",
    voiceOffButton: "वॉइस OFF",
    voiceHintShort:
      "यदि आप वॉइस चैट में शामिल नहीं हो पा रहे हैं, तो वॉइस ON / OFF को कुछ बार बदलकर देखें।",
    voiceHintDetail:
      "आवाज़ सीधे ब्राउज़र के बीच भेजी जाती है। समस्या होने पर वॉइस ON / OFF को कुछ बार बदलकर देखें। धीरे-धीरे और साफ बोलने से पहचान अधिक स्थिर रहती है。",
    chatLabel: "टेक्स्ट चैट",
    sendButton: "भेजें",
    askButlerButton: "बटलर से पूछें (वॉइस)",
    askButlerHint: "कृपया लगभग 10 सेकंड के छोटे वाक्य में सवाल पूछें।",
    nicknameDialogTitle: "निकनेम",
    nicknameDialogDesc: "कृपया इस लॉबी में उपयोग होने वाला निकनेम दर्ज करें。",
    nicknameDialogPlaceholder: "निकनेम",
    nicknameDialogOk: "OK",
    nicknameDialogCancel: "रद्द",
    toastCopied: "कॉपी कर लिया गया。",
    toastCopyFailed: "कॉपी करने में विफल。",
    toastVoicePermissionDenied:
      "माइक्रोफ़ोन की अनुमति नहीं है। कृपया ब्राउज़र सेटिंग की जाँच करें。",
    toastVoiceNotSupported:
      "यह ब्राउज़र ऑडियो रिकॉर्डिंग को सपोर्ट नहीं करता。",
    toastVoiceRecordingStarted:
      "रिकॉर्डिंग शुरू हो गई है। बोलना समाप्त होने पर बटन छोड़ दें。",
    toastVoiceRecordingStopped:
      "रिकॉर्डिंग समाप्त हुई। आपकी आवाज़ भेजी जा रही है…",
    toastVoiceApiError: "वॉइस रिकग्निशन असफल रहा。",
    toastVoiceEmptyResult:
      "आवाज़ को पहचाना नहीं जा सका। कृपया फिर से प्रयास करें。",
    toastVoiceAskSent: "आपका वॉइस प्रश्न बटलर को भेज दिया गया है。",
    toastNicknameRequired: "कृपया निकनेम दर्ज करें。",
    toastNicknameSaved: "निकनेम सहेजा गया。",
    toastRoomUrlCopied: "रूम URL कॉपी कर लिया गया。",
    toastRoomUrlCopyFailed: "रूम URL कॉपी करने में विफल。",
    toastWebSocketDisconnected: "सर्वर के साथ कनेक्शन टूट गया。",
    toastWebSocketReconnected: "सर्वर से दोबारा कनेक्ट हो गया。",
    toastRoomLimitReached: "प्रतिभागियों की सीमा पूरी हो चुकी है。",
    toastRoomNotStarted: "अभी शुरू होने का समय नहीं हुआ।",
    toastRoomExpired: "इस लॉबी की समय सीमा समाप्त हो गई है。",
    toastUnknownError: "कोई अज्ञात त्रुटि हुई。",
    chatPlaceholder: "संदेश लिखें…",
    rosterLabel: "प्रतिभागी सूची",
    rosterYou: " (आप)",
    rosterIdPrefix: "ID: ",
    rosterNone: "कोई प्रतिभागी नहीं।",
    startInfoLabel: "प्रारंभ समय",
    startInfoUnknown: "अज्ञात",
    limitInfoLabel: "अधिकतम प्रतिभागी",
    limitInfoUnknown: "अज्ञात",
    eventTypeFree: "निःशुल्क कार्यक्रम",
    eventTypePaid: "सशुल्क कार्यक्रम",
    eventTypeUnknown: "प्रकार: अज्ञात",
    priceLabel: "शुल्क",
    priceUnknown: "शुल्क: अज्ञात",
    autoSettingsLabel: "वॉइस / बातचीत सेटिंग",
    autoEchoSelfLabel: "अपनी आवाज़ खुद को भी सुनाएँ",
    autoJoinLabel: "रूम में प्रवेश करते ही स्वतः वॉइस कनेक्ट करें",
    rosterCountLabel: "वर्तमान प्रतिभागी",
  },
  he: {
    pageTitle: "לובי המתנה",
    siteName: "אתר המעריצים של DokodemoDoors",
    backToTop: "חזרה",
    changeNickname: "כינוי",
    roomTitleLabel: "טסט",
    countdownLabel: "ספירה לאחור",
    countdownDesc: "אנא המתן עד תחילת האירוע.",
    goTourButton: "צא לסיור",
    copyRoomUrlButton: "העתק כתובת לובי",
    participantsLabel: "משתתפים",
    voiceChatLabel: "משתתפים",
    voiceOnButton: "קול פועל",
    voiceOffButton: "קול כבוי",
    voiceHintShort:
      "אם אינך מצליח להצטרף לצ’אט קולי, נסה להחליף מצב קול פועל/כבוי כמה פעמים.",
    voiceHintDetail:
      "הקול עובר ישירות בין הדפדפנים. במקרה של בעיה, נסה להחליף בין קול פועל וכבוי. דיבור איטי וברור משפר את יציבות הזיהוי.",
    chatLabel: "צ’אט טקסט",
    sendButton: "שלח",
    askButlerButton: "שאל את המשרת (קול)",
    askButlerHint: "נא לשאול שאלה קצרה של כ-10 שניות.",
    nicknameDialogTitle: "כינוי",
    nicknameDialogDesc: "הזן את הכינוי שבו תשתמש בלובי זה.",
    nicknameDialogPlaceholder: "כינוי",
    nicknameDialogOk: "אישור",
    nicknameDialogCancel: "ביטול",
    toastCopied: "הועתק.",
    toastCopyFailed: "ההעתקה נכשלה.",
    toastVoicePermissionDenied:
      "השימוש במיקרופון אינו מורשה. בדוק את הגדרות הדפדפן.",
    toastVoiceNotSupported: "דפדפן זה אינו תומך בהקלטת קול.",
    toastVoiceRecordingStarted:
      "ההקלטה החלה. שחרר את הלחצן בסיום הדיבור.",
    toastVoiceRecordingStopped:
      "ההקלטה הסתיימה. השאלה הקולית נשלחת למשרת…",
    toastVoiceApiError: "זיהוי הקול נכשל.",
    toastVoiceEmptyResult:
      "לא ניתן היה לזהות את הקול. נסה שוב.",
    toastVoiceAskSent: "השאלה הקולית נשלחה למשרת.",
    toastNicknameRequired: "נא להזין כינוי.",
    toastNicknameSaved: "הכינוי נשמר.",
    toastRoomUrlCopied: "כתובת הלובי הועתקה.",
    toastRoomUrlCopyFailed: "העתקת כתובת הלובי נכשלה.",
    toastWebSocketDisconnected: "החיבור לשרת נותק.",
    toastWebSocketReconnected: "החיבור לשרת חודש.",
    toastRoomLimitReached: "הלובי מלא, לא ניתן להצטרף.",
    toastRoomNotStarted: "שעת ההתחלה עדיין לא הגיעה.",
    toastRoomExpired: "תוקף הלובי פג.",
    toastUnknownError: "אירעה שגיאה לא ידועה.",
    chatPlaceholder: "הקלד הודעה…",
    rosterLabel: "רשימת משתתפים",
    rosterYou: " (את/ה)",
    rosterIdPrefix: "ID: ",
    rosterNone: "אין משתתפים.",
    startInfoLabel: "זמן התחלה",
    startInfoUnknown: "לא ידוע",
    limitInfoLabel: "מקסימום משתתפים",
    limitInfoUnknown: "לא ידוע",
    eventTypeFree: "אירוע חינם",
    eventTypePaid: "אירוע בתשלום",
    eventTypeUnknown: "סוג: לא ידוע",
    priceLabel: "מחיר",
    priceUnknown: "מחיר: לא ידוע",
    autoSettingsLabel: "הגדרות קול ושיחה",
    autoEchoSelfLabel: "השמע את קולי גם אליי",
    autoJoinLabel: "הצטרף אוטומטית לקול בכניסה ללובי",
    rosterCountLabel: "מספר המשתתפים הנוכחי",
  },
};

// ===== 現在の言語メッセージを取得 =====
function t(key) {
  const langTable = messagesByLang[currentLang] || messagesByLang.ja;
  return langTable[key] ?? messagesByLang.ja[key] ?? key;
}

// ===== 言語切り替え UI の反映 =====
function applyLanguageToDom() {
  const bindings = [
    ["[data-i18n='pageTitle']", "pageTitle"],
    ["[data-i18n='siteName']", "siteName"],
    ["[data-i18n='backToTop']", "backToTop"],
    ["[data-i18n='changeNickname']", "changeNickname"],
    ["[data-i18n='roomTitleLabel']", "roomTitleLabel"],
    ["[data-i18n='countdownLabel']", "countdownLabel"],
    ["[data-i18n='countdownDesc']", "countdownDesc"],
    ["[data-i18n='goTourButton']", "goTourButton"],
    ["[data-i18n='copyRoomUrlButton']", "copyRoomUrlButton"],
    ["[data-i18n='participantsLabel']", "participantsLabel"],
    ["[data-i18n='voiceChatLabel']", "voiceChatLabel"],
    ["[data-i18n='voiceOnButton']", "voiceOnButton"],
    ["[data-i18n='voiceOffButton']", "voiceOffButton"],
    ["[data-i18n='voiceHintShort']", "voiceHintShort"],
    ["[data-i18n='chatLabel']", "chatLabel"],
    ["[data-i18n='sendButton']", "sendButton"],
    ["[data-i18n='askButlerButton']", "askButlerButton"],
    ["[data-i18n='askButlerHint']", "askButlerHint"],
    ["[data-i18n='nicknameDialogTitle']", "nicknameDialogTitle"],
    ["[data-i18n='nicknameDialogDesc']", "nicknameDialogDesc"],
    ["[data-i18n='nicknameDialogOk']", "nicknameDialogOk"],
    ["[data-i18n='nicknameDialogCancel']", "nicknameDialogCancel"],
    ["[data-i18n='autoSettingsLabel']", "autoSettingsLabel"],
    ["[data-i18n='autoEchoSelfLabel']", "autoEchoSelfLabel"],
    ["[data-i18n='autoJoinLabel']", "autoJoinLabel"],
    ["[data-i18n='rosterLabel']", "rosterLabel"],
    ["[data-i18n='startInfoLabel']", "startInfoLabel"],
    ["[data-i18n='limitInfoLabel']", "limitInfoLabel"],
    ["[data-i18n='eventTypeFree']", "eventTypeFree"],
    ["[data-i18n='eventTypePaid']", "eventTypePaid"],
    ["[data-i18n='eventTypeUnknown']", "eventTypeUnknown"],
    ["[data-i18n='priceLabel']", "priceLabel"],
    ["[data-i18n='priceUnknown']", "priceUnknown"],
    ["[data-i18n='rosterCountLabel']", "rosterCountLabel"],
  ];

  for (const [selector, key] of bindings) {
    $$(selector).forEach((el) => {
      el.textContent = t(key);
    });
  }

  const chatInput = byId("chatInput");
  if (chatInput) {
    chatInput.placeholder = t("chatPlaceholder");
  }

  const nicknameInput = byId("nicknameInput");
  if (nicknameInput) {
    nicknameInput.placeholder = t("nicknameDialogPlaceholder");
  }
}

function setLanguage(lang) {
  if (!validLangs.includes(lang)) return;
  currentLang = lang;
  localStorage.setItem(LS_KEY_LANG, lang);
  applyLanguageToDom();
}

// ===== トースト表示 =====
let toastTimer = null;
function showToast(text) {
  const toast = byId("toast");
  if (!toast) return;
  toast.textContent = text;
  toast.classList.add("show");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.remove("show");
  }, 3000);
}

// ===== ニックネームの読み書き =====
function loadNickname() {
  const stored = localStorage.getItem(LS_KEY_NICKNAME);
  if (stored && stored.trim()) return stored.trim();
  return "";
}

function saveNickname(name) {
  localStorage.setItem(LS_KEY_NICKNAME, name);
}

// ===== 言語自動推定（未使用だが残しておく）=====
function detectBrowserLang() {
  const navLang =
    navigator.languages?.[0] ||
    navigator.language ||
    navigator.userLanguage;
  if (!navLang) return "en";
  const lower = navLang.toLowerCase();
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("zh")) return "zh";
  if (lower.startsWith("fa")) return "fa";
  if (lower.startsWith("hi")) return "hi";
  if (lower.startsWith("he") || lower.startsWith("iw")) return "he";
  return "en";
}

// ===== WebSocket 関連 =====
let ws = null;
let myId = null;
let myNickname = loadNickname() || "";

// ===== 音声関連 =====
let localStream = null;
let pcMap = new Map();
let isVoiceOn = false;
let autoEchoSelf = localStorage.getItem(LS_KEY_VOICE_ECHO_SELF) === "1";
let autoJoinVoiceOnEnter =
  localStorage.getItem(LS_KEY_VOICE_AUTO_JOIN) === "1";

// ===== テキストチャット =====
function appendMessageLine(name, text, at, isSys) {
  const list = byId("chatList");
  if (!list) return;

  const li = document.createElement("li");
  li.classList.add("chat-item");
  if (isSys) li.classList.add("chat-sys");

  const timeStr = new Date(at).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });

  const nameSpan = document.createElement("span");
  nameSpan.classList.add("chat-name");
  nameSpan.textContent = name;

  const timeSpan = document.createElement("span");
  timeSpan.classList.add("chat-time");
  timeSpan.textContent = timeStr;

  const textSpan = document.createElement("span");
  textSpan.classList.add("chat-text");
  textSpan.textContent = text;

  li.appendChild(nameSpan);
  li.appendChild(timeSpan);
  li.appendChild(textSpan);

  list.appendChild(li);
  list.scrollTop = list.scrollHeight;
}

// ===== 参加者一覧 =====
function updateRoster(payload) {
  const list = byId("rosterList");
  const countEl = byId("rosterCount");
  if (!list) return;

  list.innerHTML = "";
  const members = payload.members || [];
  if (countEl) {
    countEl.textContent = String(members.length);
  }

  if (!members.length) {
    const li = document.createElement("li");
    li.textContent = t("rosterNone");
    list.appendChild(li);
    return;
  }

  for (const m of members) {
    const li = document.createElement("li");
    li.classList.add("roster-item");

    const nameSpan = document.createElement("span");
    nameSpan.classList.add("roster-name");
    let label = m.name;
    if (m.id === myId) {
      label += t("rosterYou");
    }
    nameSpan.textContent = label;

    const idSpan = document.createElement("span");
    idSpan.classList.add("roster-id");
    idSpan.textContent = t("rosterIdPrefix") + m.id;

    li.appendChild(nameSpan);
    li.appendChild(idSpan);

    list.appendChild(li);
  }
}

// ===== WebSocket 接続 =====
function connectWebSocket() {
  const loc = window.location;
  const wsProto = loc.protocol === "https:" ? "wss" : "ws";
  const wsUrl = `${wsProto}://${loc.host}/do-chat/ws/${encodeURIComponent(
    roomId
  )}?user=${encodeURIComponent(myNickname || "Guest")}&title=${encodeURIComponent(
    title
  )}&start=${encodeURIComponent(start)}&limit=${encodeURIComponent(
    limit
  )}&target=${encodeURIComponent(targetDecoded)}`;

  ws = new WebSocket(wsUrl);

  ws.addEventListener("open", () => {
    console.log("WebSocket connected");
  });

  ws.addEventListener("message", (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.sys) {
        if (msg.type === "welcome") {
          myId = msg.id;
        } else if (msg.type === "history") {
          const hist = msg.messages || [];
          for (const line of hist) {
            try {
              const m = JSON.parse(line);
              if (m.type === "message") {
                appendMessageLine(m.name, m.text, m.at || Date.now(), false);
              }
            } catch {}
          }
        } else if (msg.type === "roster") {
          updateRoster(msg);
        } else if (msg.type === "join") {
          updateRoster({ members: msg.members ?? [] });
        } else if (msg.type === "leave") {
          // leave 時は roster 情報が流れてこないので別口で更新されるまで待つ
        }
      } else if (msg.type === "message") {
        appendMessageLine(msg.name, msg.text, msg.at || Date.now(), msg.sys);
      } else if (msg.rtc) {
        handleRtcSignal(msg.rtc);
      }
    } catch (e) {
      console.error("ws message error", e);
    }
  });

  ws.addEventListener("close", () => {
    console.log("WebSocket closed");
    showToast(t("toastWebSocketDisconnected"));
  });

  ws.addEventListener("error", () => {
    console.log("WebSocket error");
  });
}

// ===== テキストメッセージ送信 =====
function sendChat() {
  const input = byId("chatInput");
  if (!input || !ws || ws.readyState !== WebSocket.OPEN) return;
  const text = input.value.trim();
  if (!text) return;

  ws.send(text);
  input.value = "";
}

// ===== ニックネームダイアログ =====
function openNicknameDialog() {
  const dialog = byId("nicknameDialog");
  const input = byId("nicknameInput");
  if (!dialog || !input) return;

  input.value = myNickname;
  dialog.showModal();
  input.focus();
}

function closeNicknameDialog() {
  const dialog = byId("nicknameDialog");
  if (!dialog) return;
  dialog.close();
}

function decideNickname() {
  const input = byId("nicknameInput");
  if (!input) return;

  const name = input.value.trim();
  if (!name) {
    showToast(t("toastNicknameRequired"));
    return;
  }

  myNickname = name;
  saveNickname(name);
  showToast(t("toastNicknameSaved"));
  closeNicknameDialog();

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
}

// ===== カウントダウン =====
function updateCountdown() {
  const el = byId("countdownText");
  if (!el || !startTime) return;

  const now = new Date();
  const diff = startTime.getTime() - now.getTime();
  if (diff <= 0) {
    el.textContent = "00:00:00";
    return;
  }

  const sec = Math.floor(diff / 1000);
  const h = String(Math.floor(sec / 3600)).padStart(2, "0");
  const m = String(Math.floor((sec % 3600) / 60)).padStart(2, "0");
  const s = String(sec % 60).padStart(2, "0");
  el.textContent = `${h}:${m}:${s}`;
}

// ===== ルーム情報表示 =====
function applyRoomInfo() {
  const titleEl = byId("roomTitle");
  const startEl = byId("startInfo");
  const limitEl = byId("limitInfo");
  const urlEl = byId("targetUrl");

  if (titleEl) titleEl.textContent = title || "";

  if (startEl) {
    if (startTime) {
      startEl.textContent = startTime.toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
      });
    } else {
      startEl.textContent = t("startInfoUnknown");
    }
  }

  if (limitEl) {
    if (limit) {
      limitEl.textContent = `${limit}`;
    } else {
      limitEl.textContent = t("limitInfoUnknown");
    }
  }

  if (urlEl) {
    if (targetDecoded) {
      urlEl.textContent = targetDecoded;
      urlEl.href = targetDecoded;
    } else {
      urlEl.textContent = "-";
      urlEl.href = "javascript:void(0);";
    }
  }
}

// ===== 部屋種別・料金表示（必要なら URL パラメータ等から拡張できる）=====
function applyEventTypeAndPrice() {
  const evTypeEl = byId("eventType");
  const priceEl = byId("priceInfo");
  const evType = urlParams.get("eventType");
  const price = urlParams.get("price");

  if (evTypeEl) {
    if (!evType) {
      evTypeEl.textContent = t("eventTypeUnknown");
    } else if (evType === "free") {
      evTypeEl.textContent = t("eventTypeFree");
    } else if (evType === "paid") {
      evTypeEl.textContent = t("eventTypePaid");
    } else {
      evTypeEl.textContent = t("eventTypeUnknown");
    }
  }

  if (priceEl) {
    if (price) {
      priceEl.textContent = price;
    } else {
      priceEl.textContent = t("priceUnknown");
    }
  }
}

// ===== 音声チャット（WebRTC）=====
// 簡易版：ここでは既存実装を維持しつつ、音声ON/OFFの UI 連携だけ行う

async function ensureLocalStream() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return localStream;
  } catch (e) {
    console.error(e);
    showToast(t("toastVoicePermissionDenied"));
    return null;
  }
}

// 実際の WebRTC 接続処理は簡略化しておき、既存の handleRtcSignal 等がある前提で残す
function handleRtcSignal(_payload) {
  // 以前の実装に準拠する場合はここに詳細を書く
}

// ===== 音声ON/OFF 切り替え =====
function setVoiceOnOff(on) {
  isVoiceOn = on;
  const btn = byId("voiceToggleBtn");
  const labelEl = byId("voiceToggleLabel");

  if (btn) {
    btn.textContent = on ? t("voiceOffButton") : t("voiceOnButton");
  }
  if (labelEl) {
    labelEl.textContent = t("voiceChatLabel");
  }

  if (on) {
    ensureLocalStream();
  } else {
    if (localStream) {
      for (const track of localStream.getTracks()) {
        track.stop();
      }
      localStream = null;
    }
  }
}

async function onClickVoiceToggle() {
  const next = !isVoiceOn;
  await setVoiceOnOff(next);
}

// ===== 執事への音声質問（音声→テキスト→チャット）=====

let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let voiceAskStatus = "idle";

// 状態表示を更新（ボタンの見た目など）
function setVoiceAskStatus(status) {
  voiceAskStatus = status;
  const btn = byId("voiceAskBtn");
  if (!btn) return;

  if (status === "recording") {
    btn.classList.add("recording");
  } else {
    btn.classList.remove("recording");
  }
}

// 録音開始
async function startVoiceRecording() {
  if (isRecording) return;
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    showToast(t("toastVoiceNotSupported"));
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (ev) => {
      if (ev.data.size > 0) {
        recordedChunks.push(ev.data);
      }
    };
    mediaRecorder.onstop = async () => {
      try {
        const blob = new Blob(recordedChunks, { type: "audio/webm" });
        setVoiceAskStatus("sending");
        showToast(t("toastVoiceRecordingStopped"));

        const formData = new FormData();
        formData.append("roomId", roomId);
        formData.append("audio", blob, "voice.webm");

        const res = await fetch("https://do-chat.awachima7.workers.dev/do-chat/voice", {
          method: "POST",
          body: formData,
        });
        if (!res.ok) {
          throw new Error("voice api error: " + res.status);
        }
        setVoiceAskStatus(
          "idle"
        );
        const json = await res.json().catch(() => null);
        console.log("voice api result:", json);
        if (json && json.ok) {
          if (!json.text || !json.text.trim()) {
            showToast(t("toastVoiceEmptyResult"));
          } else {
            showToast(t("toastVoiceAskSent"));
          }
        } else {
          showToast(t("toastVoiceApiError"));
        }
      } catch (e) {
        console.error(e);
        setVoiceAskStatus("idle");
        showToast(t("toastVoiceApiError"));
      }
    };

    mediaRecorder.start();
    isRecording = true;
    setVoiceAskStatus("recording");
    showToast(t("toastVoiceRecordingStarted"));
  } catch (e) {
    console.error(e);
    showToast(t("toastVoicePermissionDenied"));
  }
}

// 録音停止
function stopVoiceRecording() {
  if (!isRecording || !mediaRecorder) return;
  isRecording = false;
  mediaRecorder.stop();
  mediaRecorder.stream.getTracks().forEach((t) => t.stop());
  mediaRecorder = null;
}

// ===== イベントリスナー登録 =====
function setupEventHandlers() {
  const sendBtn = byId("sendBtn");
  if (sendBtn) {
    sendBtn.addEventListener("click", sendChat);
  }

  const chatInput = byId("chatInput");
  if (chatInput) {
    chatInput.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.isComposing) {
        ev.preventDefault();
        sendChat();
      }
    });
  }

  const nicknameBtn = byId("nicknameBtn");
  if (nicknameBtn) {
    nicknameBtn.addEventListener("click", openNicknameDialog);
  }

  const nicknameOk = byId("nicknameOk");
  if (nicknameOk) {
    nicknameOk.addEventListener("click", decideNickname);
  }

  const nicknameCancel = byId("nicknameCancel");
  if (nicknameCancel) {
    nicknameCancel.addEventListener("click", closeNicknameDialog);
  }

  const backBtn = byId("backBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      window.location.href = "/";
    });
  }

  const copyRoomUrlBtn = byId("copyRoomUrlBtn");
  if (copyRoomUrlBtn) {
    copyRoomUrlBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(window.location.href);
        showToast(t("toastRoomUrlCopied"));
      } catch {
        showToast(t("toastRoomUrlCopyFailed"));
      }
    });
  }

  const voiceToggleBtn = byId("voiceToggleBtn");
  if (voiceToggleBtn) {
    voiceToggleBtn.addEventListener("click", onClickVoiceToggle);
  }

  const voiceAskBtn = byId("voiceAskBtn");
  if (voiceAskBtn) {
    voiceAskBtn.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      startVoiceRecording();
    });
    voiceAskBtn.addEventListener("touchstart", (ev) => {
      ev.preventDefault();
      startVoiceRecording();
    });
    const stopEvents = ["mouseup", "mouseleave", "touchend", "touchcancel"];
    for (const evName of stopEvents) {
      voiceAskBtn.addEventListener(evName, (ev) => {
        ev.preventDefault();
        stopVoiceRecording();
      });
    }
  }

  const autoEchoCheckbox = byId("autoEchoSelf");
  if (autoEchoCheckbox) {
    autoEchoCheckbox.checked = autoEchoSelf;
    autoEchoCheckbox.addEventListener("change", () => {
      autoEchoSelf = autoEchoCheckbox.checked;
      localStorage.setItem(LS_KEY_VOICE_ECHO_SELF, autoEchoSelf ? "1" : "0");
    });
  }

  const autoJoinCheckbox = byId("autoJoinVoice");
  if (autoJoinCheckbox) {
    autoJoinCheckbox.checked = autoJoinVoiceOnEnter;
    autoJoinCheckbox.addEventListener("change", () => {
      autoJoinVoiceOnEnter = autoJoinCheckbox.checked;
      localStorage.setItem(
        LS_KEY_VOICE_AUTO_JOIN,
        autoJoinVoiceOnEnter ? "1" : "0"
      );
    });
  }
}

// ===== 初期化 =====
function init() {
  applyLanguageToDom();
  applyRoomInfo();
  applyEventTypeAndPrice();
  setupEventHandlers();

  if (!myNickname) {
    openNicknameDialog();
  } else {
    connectWebSocket();
  }

  if (startTime) {
    updateCountdown();
    setInterval(updateCountdown, 1000);
  }

  if (autoJoinVoiceOnEnter) {
    setVoiceOnOff(true);
  }

  validLangs.forEach((lang) => {
    const btn = byId(`lang-${lang}`);
    if (btn) {
      btn.addEventListener("click", () => setLanguage(lang));
    }
  });
}

window.addEventListener("DOMContentLoaded", init);
