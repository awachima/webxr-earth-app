/**
 * Lucy-recommend Worker (Final Corrected Version 8)
 * - Fix 1-6: Previous fixes (Loop prevention, Keyword alias, etc.)
 * - Fix 7: Enable "Chat" in S3.
 * - Fix 8: Enable "Recommend" in S3. 
 * Previously, asking for "Recommend" in S3 fell back to searching the old keyword again.
 * Now it correctly transitions to S5 (Recommendation Mode).
 */

// ==========================================
// 定数・設定
// ==========================================
const LOCATION_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vQKDucOdVD9mvoZHq-HIOxi_J1L8s9Qjh7hP3oU_oTQrh1k_4tvB8m9ZRtp9Lond1XqVDdu5R8bNAsW/pub?gid=717261533&single=true&output=csv";
const TREE_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vTxY1OEEnEqJi1gK6D156ql0Ybe5Hqsn-mrAmvC3p98oRYYdXFNTjUY3-SMNgusPHqowztL3aAF3COl/pub?gid=0&single=true&output=csv";

const MISS_COL_G = 6;
const MISS_COL_H = 7;

const STEP_S0 = "S0";
const STEP_S1 = "S1";
const STEP_S1_RESTART = "S1_RESTART";
const STEP_S2 = "S2";
const STEP_S3 = "S3";
const STEP_S4 = "S4";
const STEP_S5 = "S5";
const STEP_S6 = "S6";

const LANG_SETTINGS = {
  ja: { name: "Japanese", prompt: "日本語（親しみやすい敬語）", sep: "と", suffix: "でしたら、どちらの気分ですか？", quote: "「", unquote: "」" },
  en: { name: "English", prompt: "English", sep: " or ", suffix: ", which would you prefer?", quote: '"', unquote: '"' },
  zh: { name: "Chinese", prompt: "Chinese (Simplified)", sep: "还是", suffix: "，您更喜欢哪一个？", quote: "“", unquote: "”" },
  hi: { name: "Hindi", prompt: "Hindi", sep: " या ", suffix: ", आप किसे पसंद करेंगे?", quote: '"', unquote: '"' },
  he: { name: "Hebrew", prompt: "Hebrew", sep: " או ", suffix: ", מה תעדיפו?", quote: '"', unquote: '"' },
  fa: { name: "Persian", prompt: "Persian", sep: " یا ", suffix: "، کدام را ترجیح می‌دهید؟", quote: '"', unquote: '"' }
};

const MESSAGES = {
  ja: {
    greeting: "いらっしゃいませ。ツアーをお探しですか？",
    error_listen: "申し訳ありません。うまく聞き取れませんでした。",
    error_system: "エラーが発生しました。",
    confirm_prefix: "では、",
    preface_vague: "承知いたしました。では、好みを絞るために少し質問させてください！",
    preface_reset: "すみません、もう一度質問させてください。",
    preface_change: "承知しました！では、気分を変えて…",
    preface_point: "では、少し視点を変えて聞いてみますね！",
    recommend_fallback: "お勧めと言われると9割がたお勧めなのですが…私のお気に入りでもよろしければご紹介します！いかがでしょう？",
    recommend_after_two_rejects: "承知いたしました。では、いったんこちらからおすすめをいくつかご紹介いたしますね。",
    restart_ask: "よろしければ、もう一度、候補を絞るために質問しても良いでしょうか？",
    restart_decline: "承知しました。必要になりましたら、いつでもお声がけくださいね。",
    // ★追加: 「おすすめを聞かれたが該当なし」用メッセージ
    recommend_not_found: (kw) => `すみません、${kw}の「おすすめ」は見つかりませんでした…。もう少し別の言葉で探していただけますか？（例：自然／街歩き／絶景／教会 など）`,
    wait: "承知しました！お待ちします！",
    no_more_tours: (kw) => `すみません、${kw}に関するツアーはこれですべてご紹介してしまいました…。\n別のカテゴリで探してみましょうか？`,
    detail_unknown: "申し訳ありません。ちょっと私、内容までは把握できてないんですよ…。無課金の生成AIなんで、動画の中を見るとこまではできてないんです…。",
    not_found: (txt) => `${txt}ですね。\nうーん…。申し訳ありません。ちょっとご紹介できるツアーが見当たりません…。`,
    retry: "すみません、もう一度お願いします。",
    nice: "よっしゃ！ぜひご覧ください！",
    miss_match: "これ違いました？あ、でもまだ他にもありますよ！",
    no_match: "そうですかー。残念！あ、でもまだ他にもありますよ！",
    tour_not_found: "すみません、ツアー情報が見つかりませんでした…。",
    intro_prefix: (kw) => `えっとですね！これとかどうでしょう？`,
    intro_miss_prefix: (kw) => `ちょっと「${kw || ""}」のものはないんですけど…。\nあ、でも、カテゴリ的には近いこれとかどうでしょう？`,
    busy: "すみません、今は雑談できないんです。",
    ai_role_error: "AIなもので、実体験はなくて…すみません。",
    dynamic_confirm: "決めかねますよね！\n別の角度で絞り込んでみましょうか？",
    search_keyword_prefix: (kw) => `${kw}ですね。\nそれでしたら、こちらは如何でしょうか？\n`,
    search_tree_prefix: (kw) => `${kw}ですね。\nそれでしたら、例えば以下のようなツアーがありますが如何でしょうか？\n`,
    search_tree_options: (kw) => `${kw}ですね。\nそれでしたら、例えば以下のようなツアーがありますが、この中でしたらどれがお好みでしょうか？\n`,
  },
  en: {
    greeting: "Welcome! Are you looking for a tour?",
    error_listen: "Sorry, I didn't quite catch that.",
    error_system: "An error occurred.",
    confirm_prefix: "Well then, ",
    preface_vague: "Understood. Let me ask a few questions to narrow down your preferences!",
    preface_reset: "Sorry, let me ask again.",
    preface_change: "Understood! Let's change the mood...",
    preface_point: "Let's try a different perspective!",
    recommend_fallback: "I recommend almost everything, but I can share my personal favorites! How about that?",
    restart_ask: "If you'd like, may I ask a few questions again to narrow down the candidates?",
    restart_decline: "Understood. If you need anything, just let me know anytime.",
    recommend_not_found: (kw) => `Sorry, I couldn't find any "recommended" tours for ${kw}. Could you try a different keyword? (e.g., nature / city walk / views / churches)`,
    wait: "Okay! I'll wait.",
    no_more_tours: (kw) => `Sorry, I've shown you all the tours related to "${kw}"...\nShall we look for a different category?`,
    detail_unknown: "I'm sorry, I don't know the specific details... As an AI, I can't actually watch the videos...",
    not_found: (txt) => `"${txt}", right?\nHmm... I'm sorry, I can't seem to find any tours matching that...`,
    retry: "Sorry, could you say that again?",
    nice: "Awesome! Please check it out!",
    miss_match: "Was that not it? No worries, I have others!",
    no_match: "Is that so? Too bad! But I have others!",
    tour_not_found: "Sorry, I couldn't find any tour information...",
    intro_prefix: (kw) => `How about this one?`,
    intro_miss_prefix: (kw) => `I don't have anything strictly for "${kw || ""}"...\nBut how about these similar ones instead?`,
    busy: "Sorry, I can't chat right now.",
    ai_role_error: "I'm an AI, so I don't have real experiences... sorry.",
    dynamic_confirm: "It's hard to decide, isn't it!\nShall we try narrowing it down from a different angle?",
    search_keyword_prefix: (kw) => `"${kw}", I see.\nIn that case, how about these?\n`,
    search_tree_prefix: (kw) => `"${kw}", I see.\nFor that, I have these tours. How about them?\n`,
    search_tree_options: (kw) => `"${kw}", I see.\nFor that, I have tours like these. Which one do you prefer?\n`,
  },
  zh: {
    greeting: "欢迎光临！您在找旅游团吗？",
    error_listen: "抱歉，我没听清楚。",
    error_system: "发生错误。",
    confirm_prefix: "那么，",
    preface_vague: "明白了。为了缩小范围，请允许我问几个问题！",
    preface_reset: "抱歉，请让我再问一次。",
    preface_change: "明白了！那我们换个心情……",
    preface_point: "那么，让我们换个角度来看看！",
    recommend_fallback: "虽然我想推荐所有的，但我可以分享一些我个人的最爱！您看怎么样？",
    recommend_not_found: (kw) => `抱歉，我找不到关于“${kw}”的“推荐”内容。您可以换个关键词再试试吗？（例如：自然/城市漫步/风景/教堂）`,
    wait: "好的！请稍等。",
    no_more_tours: (kw) => `抱歉，关于“${kw}”的旅游团我已经全部介绍完了……\n我们要不要找找别的类别？`,
    detail_unknown: "抱歉，我不清楚具体细节……因为我是AI，无法实际观看视频……",
    not_found: (txt) => `“${txt}”是吗？\n嗯……抱歉，我好像找不到相关的旅游团……`,
    retry: "抱歉，请您再说一遍好吗？",
    nice: "太棒了！请务必看看！",
    miss_match: "不是这个吗？没关系，我还有别的！",
    no_match: "是吗？太可惜了！但我还有别的！",
    tour_not_found: "抱歉，我找不到旅游信息……",
    intro_miss_prefix: (kw) => `虽然没有完全符合“${kw || ""}”的……\n但是这些类似的怎么样？`,
    intro_prefix: (kw) => `这个怎么样？`,
    busy: "抱歉，我现在不能聊天。",
    ai_role_error: "我是AI，所以没有实际体验……抱歉。",
    dynamic_confirm: "很难决定对吧！\n我们要不要换个角度来缩小范围？",
    search_keyword_prefix: (kw) => `“${kw}”是吧。\n那样的话，这些怎么样？\n`,
    search_tree_prefix: (kw) => `“${kw}”是吧。\n那样的话，有这些旅游团。您觉得怎么样？\n`,
    search_tree_options: (kw) => `“${kw}”是吧。\n那样的话，有这些旅游团。您更喜欢哪一个？\n`,
  },
  hi: {
    greeting: "नमस्ते! क्या आप यात्रा (टूर) की तलाश में हैं?",
    error_listen: "क्षमा करें, मैं ठीक से सुन नहीं पायी।",
    error_system: "एक त्रुटि हुई है।",
    confirm_prefix: "तो फिर, ",
    preface_vague: "समझ गयी। अपनी पसंद को सीमित करने के लिए, मुझे कुछ प्रश्न पूछने दें!",
    preface_reset: "क्षमा करें, मुझे फिर से पूछने दें।",
    preface_change: "समझ गयी! चलो मूड बदलते हैं...",
    preface_point: "चलो एक अलग दृष्टिकोण से कोशिश करते हैं!",
    recommend_fallback: "मैं लगभग सब कुछ सुझाती हूँ, लेकिन मैं अपने निजी पसंदीदा साझा कर सकती हूँ! कैसा रहेगा?",
    recommend_not_found: (kw) => `माफ़ कीजिए, मुझे ${kw} के लिए कोई “recommended” टूर नहीं मिला। क्या आप कोई दूसरा कीवर्ड आज़मा सकते हैं? (जैसे: nature / city walk / views / churches)`,
    wait: "ठीक है! मैं इंतजार करूँगी।",
    no_more_tours: (kw) => `क्षमा करें, मैंने "${kw}" से संबंधित सभी टूर दिखा दिए हैं...\nक्या हम किसी और श्रेणी में देखें?`,
    detail_unknown: "क्षमा करें, मुझे विस्तृत जानकारी नहीं है... एक AI के रूप में, मैं वास्तव में वीडियो नहीं देख सकती...",
    not_found: (txt) => `"${txt}", है ना?\nहम्म... क्षमा करें, मुझे उससे मेल खाता कोई टूर नहीं मिल रहा...`,
    retry: "क्षमा करें, क्या आप फिर से बोल सकते हैं?",
    nice: "बहुत बढ़िया! कृपया इसे देखें!",
    miss_match: "क्या यह वह नहीं था? कोई बात नहीं, मेरे पास और भी हैं!",
    no_match: "क्या ऐसा है? अफसोस! लेकिन मेरे पास और भी हैं!",
    tour_not_found: "क्षमा करें, मुझे कोई टूर जानकारी नहीं मिली...",
    intro_miss_prefix: (kw) => `मेरे पास "${kw || ""}" के लिए कुछ खास नहीं है...\nलेकिन इसके बजाय ये कैसे रहेंगे?`,
    intro_prefix: (kw) => `यह वाला कैसा रहेगा?`,
    busy: "क्षमा करें, मैं अभी बात नहीं कर सकती।",
    ai_role_error: "मैं एक AI हूँ, इसलिए मेरे पास वास्तविक अनुभव नहीं हैं... क्षमा करें।",
    dynamic_confirm: "निर्णय लेना कठिन है, है ना!\nक्या हम इसे एक अलग दृष्टिकोण से सीमित करने का प्रयास करें?",
    search_keyword_prefix: (kw) => `"${kw}", मैं समझती हूँ।\nउस स्थिति में, ये कैसे रहेंगे?\n`,
    search_tree_prefix: (kw) => `"${kw}", मैं समझती हूँ।\nउसके लिए, मेरे पास ये टूर हैं। ये कैसे रहेंगे?\n`,
    search_tree_options: (kw) => `"${kw}", मैं समझती हूँ।\nउसके लिए, मेरे पास ऐसे टूर हैं। आप किसे पसंद करेंगे?\n`,
  },
  he: {
    greeting: "שלום! אתם מחפשים סיור?",
    error_listen: "סליחה, לא ממש הבנתי.",
    error_system: "אירעה שגיאה.",
    confirm_prefix: "ובכן, ",
    preface_vague: "הבנתי. הרשו לי לשאול כמה שאלות כדי לצמצם את האפשרויות!",
    preface_reset: "סליחה, הרשו לי לשאול שוב.",
    preface_change: "הבנתי! בואו נשנה אווירה...",
    preface_point: "בואו ננסה נקודת מבט אחרת!",
    recommend_fallback: "אני ממליצה על כמעט הכל, אבל אני יכולה לשתף את המועדפים האישיים שלי! מה דעתכם?",
    recommend_not_found: (kw) => `סליחה, לא מצאתי "המלצות" עבור ${kw}. תוכלו לנסות מילת חיפוש אחרת? (למשל: טבע / עיר / נופים / כנסיות)`,
    wait: "אוקיי! אני אמתין.",
    no_more_tours: (kw) => `סליחה, הראיתי לכם את כל הסיורים הקשורים ל-"${kw}"...\nשנחפש קטגוריה אחרת?`,
    detail_unknown: "סליחה, אני לא יודעת את הפרטים המדויקים... כבינה מלאכותית, אני לא יכולה לצפות בסרטונים...",
    not_found: (txt) => `"${txt}", נכון?\nהממ... סליחה, אני לא מוצאת סיורים תואמים...`,
    retry: "סליחה, תוכלו להגיד את זה שוב?",
    nice: "מעולה! בבקשה תבדקו את זה!",
    miss_match: "זה לא היה זה? אל דאגה, יש לי אחרים!",
    no_match: "באמת? חבל! אבל יש לי אחרים!",
    tour_not_found: "סליחה, לא מצאתי מידע על סיורים...",
    intro_miss_prefix: (kw) => `אין לי משהו ספציפי ל-"${kw || ""}"...\nאבל מה דעתכם על אלה במקום?`,
    intro_prefix: (kw) => `איך זה נראה לכם?`,
    busy: "סליחה, אני לא יכולה לשוחח כרגע.",
    ai_role_error: "אני בינה מלאכותית, אז אין לי חוויות אמיתיות... סליחה.",
    dynamic_confirm: "קשה להחליט, נכון!\nשננסה לצמצם את זה מזווית אחרת?",
    search_keyword_prefix: (kw) => `"${kw}", אני מבינה.\nבמקרה הזה, מה דעתכם על אלה?\n`,
    search_tree_prefix: (kw) => `"${kw}", אני מבינה.\nבשביל זה, יש לי את הסיורים האלה. מה דעתכם?\n`,
    search_tree_options: (kw) => `"${kw}", אני מבינה.\nבשביל זה, יש לי סיורים כאלה. מה תעדיפו?\n`,
  },
  fa: {
    greeting: "سلام! آیا به دنبال تور هستید؟",
    error_listen: "متاسفم، متوجه نشدم.",
    error_system: "خطایی رخ داد.",
    confirm_prefix: "بسیار خب، ",
    preface_vague: "متوجه شدم. اجازه دهید چند سوال بپرسم تا گزینه‌ها را محدود کنیم!",
    preface_reset: "متاسفم، اجازه دهید دوباره بپرسم.",
    preface_change: "متوجه شدم! بیایید حال و هوا را عوض کنیم...",
    preface_point: "بیایید از زاویه دیگری تلاش کنیم!",
    recommend_fallback: "من تقریبا همه چیز را پیشنهاد می‌کنم، اما می‌توانم موارد مورد علاقه خودم را به اشتراک بگذارم! نظرتان چیست؟",
    recommend_not_found: (kw) => `متاسفم، برای ${kw} هیچ مورد «پیشنهادی/Recommended» پیدا نکردم. می‌توانید با کلمهٔ دیگری امتحان کنید؟ (مثل: طبیعت / شهر / منظره / کلیسا)`,
    wait: "بسیار خب! منتظر می‌مانم.",
    no_more_tours: (kw) => `متاسفم، من تمام تورهای مربوط به "${kw}" را نشان دادم...\nآیا در دسته‌بندی دیگری جستجو کنیم؟`,
    detail_unknown: "متاسفم، جزئیات دقیق را نمی‌دانم... به عنوان هوش مصنوعی، نمی‌توانم ویدیوها را تماشا کنم...",
    not_found: (txt) => `"${txt}"، درست است؟\nهمم... متاسفم، توری که با آن مطابقت داشته باشد پیدا نمی‌کنم...`,
    retry: "متاسفم، می‌شود دوباره بگویید؟",
    nice: "عالیه! لطفا بررسی کنید!",
    miss_match: "این نبود؟ نگران نباشید، موارد دیگری دارم!",
    no_match: "اینطور است؟ حیف شد! اما موارد دیگری دارم!",
    tour_not_found: "متاسفم، اطلاعات توری پیدا نکردم...",
    intro_miss_prefix: (kw) => `من مورد دقیقی برای "${kw || ""}" ندارم...\nاما نظرتان در مورد این‌ها چیست؟`,
    intro_prefix: (kw) => `نظرتان در مورد این یکی چیست؟`,
    busy: "متاسفم، الان نمی‌توانم صحبت کنم.",
    ai_role_error: "من هوش مصنوعی هستم، بنابراین تجربیات واقعی ندارم... متاسفم.",
    dynamic_confirm: "تصمیم‌گیری سخت است، نه!\nآیا سعی کنیم از زاویه دیگری محدودش کنیم؟",
    search_keyword_prefix: (kw) => `"${kw}"، متوجه شدم.\nدر این صورت، نظرتان در مورد این‌ها چیست؟\n`,
    search_tree_prefix: (kw) => `"${kw}"، متوجه شدم.\nبرای آن، من این تورها را دارم. نظرتان چیست؟\n`,
    search_tree_options: (kw) => `"${kw}"، متوجه شدم.\nبرای آن، من تورهایی مثل این‌ها دارم. کدام را ترجیح می‌دهید؟\n`,
  }
};

const KEYWORD_ALIASES = {
  // 揺らぎ吸収のみ
  "クルマ": "ドライブ", "くるま": "ドライブ", "自動車": "ドライブ", "レンタカー": "ドライブ",
  "ドライブツアー": "ドライブ", "運転": "ドライブ", 
  "ご飯": "グルメ", "ごはん": "グルメ", "食事": "グルメ", "レストラン": "グルメ",
  "泳ぐ": "海", "泳ぎ": "海", "海ツアー": "海", "ビーチ": "海",
  "観光": "街", "観光ツアー": "街", "街歩き": "街"
};

const SEARCH_GROUPS = {
  "乗り物": ["乗り物", "車", "船", "セスナ", "鉄道", "クルーズ", "ドライブ", "バス", "列車", "飛行機", "ヘリ", "ボート", "遊覧", "サファリカー"],
  "グルメ": ["グルメ", "食事", "ランチ", "ディナー", "料理", "食べ", "酒", "ワイン", "市場", "屋台"],
  "動物": ["動物", "アニマル", "サファリ", "野生", "猫", "犬", "鳥", "水族館", "牧場"],
  "教会": ["教会", "大聖堂", "聖堂", "礼拝堂", "チャペル", "チャーチ", "カテドラル", "バシリカ"],
  "仏教": ["仏教", "寺院", "仏寺", "仏閣", "僧院", "僧侶", "仏像", "仏塔", "ストゥーパ", "菩提寺"],
  "宗教": ["教会", "大聖堂", "聖堂", "礼拝堂", "寺院", "修道院", "モスク", "神殿", "宗教", "仏教", "キリスト", "イスラム", "ヒンドゥー", "遺産"],
  "ヒンドゥー": ["ヒンドゥー", "ヒンドゥー教", "ヒンドゥー寺院", "ヒンドゥー神殿", "ヒンドゥーテンプル", "シヴァ", "ヴィシュヌ", "ブラフマー", "ガネーシャ"],
  "遺跡": ["遺跡", "世界遺産", "歴史", "古代", "廃墟", "遺産", "神殿", "城跡", "宮殿", "旧市街"],
  "絶景": ["絶景", "景色", "風景", "眺め", "自然", "美し", "ビュー", "パノラマ", "神秘", "山", "海", "湖"],
  "街": ["街", "シティ", "都市", "町", "タウン", "通り", "市場", "広場", "旧市街"]
};

const OPT_DEFS = {
  NATURE: { disp: "自然の景色", key: "自然", match: ["自然", "景色", "海", "山", "絶景", "ネイチャー", "眺め", "風景"] },
  CITY_S: { disp: "街", key: "街", match: ["街", "シティ", "都会", "町"] },
  ARCH:   { disp: "建築物", key: "建築・ランドマーク", match: ["建築", "建物", "ランドマーク", "ビル", "タワー", "城", "宮殿", "遺産"] },
  THEME:  { disp: "テーマパークや水族館、あるいは動物園を見て回るなど", key: "娯楽施設", match: ["テーマパーク", "水族館", "動物園", "遊園地", "アミューズメント", "園", "パーク", "見て回る"] },
  CHURCH: { disp: "教会や寺院など", key: "宗教", match: ["教会", "寺院", "神社", "モスク", "大聖堂", "宗教", "寺"] },
  SHOW:   { disp: "ショーを見たり音楽を聴いたり", key: "文化", match: ["ショー", "音楽", "ミュージカル", "ライブ", "観劇", "コンサート", "聴", "きく", "観"] },
  STROLL: { disp: "街や市場をそぞろ歩きするなど", key: "街並み・暮らし", match: ["そぞろ歩き", "市場", "マーケット", "散策", "ぶらぶら", "歩く", "歩き", "歩", "暮らし", "路地"] },
  MUSEUM: { disp: "博物館や美術館を見て回るなど", key: "文化", match: ["博物館", "美術館", "ミュージアム", "アート", "絵画", "展示", "鑑賞"] },
  VEHICLE:{ disp: "車や船やセスナなど乗り物に乗ったりするの", key: "乗り物", match: ["車", "船", "セスナ", "乗り物", "乗", "のる", "クルーズ", "ドライブ", "飛行機"] },
  RUINS:  { disp: "古代遺跡", key: "遺跡", match: ["遺跡", "古代", "歴史", "遺産", "廃墟"] },
  LIFE:   { disp: "今の街並みや暮らしを見て歩くなど", key: "街並み・暮らし", match: ["暮らし", "生活", "人々", "街並み", "現代", "歩", "歩く"] }
};

const S2_SCENARIOS = [
  { fixed: OPT_DEFS.NATURE, candidates: [OPT_DEFS.CITY_S, OPT_DEFS.ARCH, OPT_DEFS.THEME, OPT_DEFS.CHURCH, OPT_DEFS.SHOW, OPT_DEFS.STROLL, OPT_DEFS.MUSEUM] },
  { fixed: OPT_DEFS.VEHICLE, candidates: [OPT_DEFS.SHOW, OPT_DEFS.THEME, OPT_DEFS.STROLL, OPT_DEFS.MUSEUM] },
  { fixed: OPT_DEFS.RUINS, candidates: [OPT_DEFS.LIFE, OPT_DEFS.THEME, OPT_DEFS.SHOW, OPT_DEFS.STROLL, OPT_DEFS.MUSEUM] },
  { fixed: OPT_DEFS.STROLL, candidates: [OPT_DEFS.NATURE, OPT_DEFS.VEHICLE, OPT_DEFS.THEME, OPT_DEFS.SHOW, OPT_DEFS.MUSEUM] }
];

let _cache = {
  loadedAtMs: 0,
  ttlMs: 5 * 60 * 1000,
  location: null,
  tree: null
};

// ==========================================
// Main Worker
// ==========================================
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({ ok: true, service: "lucy-recommend-gemini-stt" }, 200, corsHeaders());
    }

    if (url.pathname === "/voice" && request.method === "POST") {
      try {
        const { audioBytes, mimeType, stateIn, lang } = await readVoiceInput(request);
        const state = normalizeState(stateIn);
        const transcript = await speechToText(env, audioBytes, mimeType, lang);

        if (!transcript || !String(transcript).trim()) {
          const t = MESSAGES[lang] || MESSAGES.ja;
          return json(
            { ok: false, error: t.error_listen || "Speech-to-text failed." },
            400,
            corsHeaders()
          );
        }

        const data = await getData(ctx);
        const allowDebug = env.ALLOW_DEBUG === "1";
        const res = await runChatPipeline(String(transcript).trim(), state, data, env, lang);

        return json(
          {
            ok: true,
            transcript: String(transcript).trim(),
            reply: res.reply,
            nextState: res.nextState,
            debug: allowDebug ? res.debug : undefined
          },
          200,
          corsHeaders()
        );
      } catch (err) {
        return json({ ok: false, error: err.message }, 500, corsHeaders());
      }
    }

    if (url.pathname === "/chat" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const userText = typeof body.userText === "string" ? body.userText.trim() : "";
        const state = normalizeState(body.state || {});
        const lang = body.lang || "ja";
        
        const data = await getData(ctx);
        const allowDebug = env.ALLOW_DEBUG === "1";
        const res = await runChatPipeline(userText, state, data, env, lang);

        return json(
          { ok: true, reply: res.reply, nextState: res.nextState, debug: allowDebug ? res.debug : undefined },
          200,
          corsHeaders()
        );
      } catch (err) {
        return json({ ok: false, error: err.message }, 500, corsHeaders());
      }
    }

    return json({ error: "Not Found" }, 404, corsHeaders());
  }
};

// ==========================================
// 音声認識 (Gemini 2.0 Flash)
// ==========================================
async function speechToText(env, audioBytes, mimeType, lang) {
  if (!env || !env.GEMINI_API_KEY) {
    throw new Error("Server Error: GEMINI_API_KEY is not configured.");
  }

  const MODEL_NAME = "gemini-2.0-flash"; 
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${env.GEMINI_API_KEY}`;

  const base64Audio = arrayBufferToBase64(audioBytes);
  const langName = (LANG_SETTINGS[lang] || LANG_SETTINGS.ja).name;

  const promptText = `Transcribe the following audio file into ${langName}. The user is speaking to an AI assistant. Output only the transcribed text.`;

  const payload = {
    contents: [{
      parts: [
        { text: promptText },
        { 
          inline_data: { 
            mime_type: mimeType || "audio/webm", 
            data: base64Audio 
          } 
        }
      ]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 256,
    }
  };

  try {
    const res = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini STT API Error: ${res.status} ${errText}`);
    }

    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

  } catch (e) {
    console.error("Gemini STT Error:", e);
    throw e;
  }
}

// ==========================================
// ヘルパー関数
// ==========================================
function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  const chunkSize = 0x8000;
  for (let i = 0; i < len; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToUint8Array(b64) {
  const cleaned = String(b64).includes("base64,") ? String(b64).split("base64,")[1] : String(b64);
  const bin = atob(cleaned);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function normalizeState(stateIn) {
  const s = stateIn || {};
  return {
    step: s.step || STEP_S0,
    turnCount: Number(s.turnCount) || 0,
    history: Array.isArray(s.history) ? s.history : [],
    currentKeyword: s.currentKeyword || null,
    shownUrls: Array.isArray(s.shownUrls) ? s.shownUrls : [],
    dynamicOptions: s.dynamicOptions || null
  };
}

async function readVoiceInput(request) {
  const ct = (request.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("audio");
    const stateRaw = form.get("state");
    const lang = form.get("lang") || "ja";
    if (!file || typeof file === "string") throw new Error('No audio file provided.');
    const audioBytes = new Uint8Array(await file.arrayBuffer());
    const mimeType = String(file.type || "audio/webm"); 
    const stateIn = stateRaw ? safeJsonParse(String(stateRaw)) || {} : {};
    return { audioBytes, mimeType, stateIn, lang };
  }
  if (ct.includes("application/json")) {
    const body = await request.json().catch(() => ({}));
    const audioBase64 = typeof body.audioBase64 === "string" ? body.audioBase64 : "";
    if (!audioBase64) throw new Error("Audio base64 missing.");
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "audio/webm";
    const audioBytes = base64ToUint8Array(audioBase64);
    const stateIn = body.state || {};
    const lang = body.lang || "ja";
    return { audioBytes, mimeType, stateIn, lang };
  }
  const audioBytes = new Uint8Array(await request.arrayBuffer());
  if (!audioBytes || audioBytes.length === 0) throw new Error("Empty audio body.");
  const mimeType = request.headers.get("content-type") || "audio/webm";
  return { audioBytes, mimeType, stateIn: {}, lang: "ja" };
}

function safeJsonParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

function corsHeaders() {
  return { 
    "access-control-allow-origin": "*", 
    "access-control-allow-methods": "POST, GET, OPTIONS", 
    "access-control-allow-headers": "content-type" 
  };
}

// キーワードをクリーニングする関数
function cleanKeyword(kw) {
  if (!kw) return kw;
  if (KEYWORD_ALIASES[kw]) return KEYWORD_ALIASES[kw];
  return kw.replace(/(ツアー|旅行)$/, "");
}

function json(data, status, headers) {
  return new Response(JSON.stringify(data), { 
    status, 
    headers: { ...headers, "content-type": "application/json" } 
  });
}

// ★追加: 質問生成ヘルパー
function startQuestionSequence(state, preamble, env, lang) {
  // シナリオをランダム選択
  const scenario = S2_SCENARIOS[Math.floor(Math.random() * S2_SCENARIOS.length)];
  const optA = scenario.fixed;
  const optB = scenario.candidates[Math.floor(Math.random() * scenario.candidates.length)];
  
  // A/Bの順序をランダム化
  const isReverse = Math.random() > 0.5;
  const A = isReverse ? optB : optA;
  const B = isReverse ? optA : optB;

  // ★質問文を箇条書き形式に変更
  const header =
    lang === "ja" ? "以下でしたらどちらの気分ですか？" :
    lang === "en" ? "Which would you prefer?" :
    lang === "zh" ? "以下您更喜欢哪一个？" :
    lang === "hi" ? "इनमें आप किसे पसंद करेंगे?" :
    lang === "he" ? "מה תעדיפו מבין הבאים?" :
    lang === "fa" ? "در میان موارد زیر کدام را ترجیح می‌دهید؟" :
    "Which would you prefer?";

  const bullet = (lang === "en") ? "- " : "・";
  const lineA = `${bullet}${A.disp}`;
  const lineB = `${bullet}${B.disp}`;

  const question = `${header}\n${lineA}\n${lineB}`;
  const reply = `${preamble}\n${question}`;
  
  const nextState = {
    ...state,
    step: STEP_S2,
    dynamicOptions: {
      targetA: A.key,
      displayA: A.disp,
      targetB: B.key,
      displayB: B.disp
    }
  };
  return { reply, nextState };
}

// ==========================================
// 会話パイプライン
// ==========================================
async function runChatPipeline(userText, state, data, env, lang = "ja") {
  const t = MESSAGES[lang] || MESSAGES.ja;

  if (state.step === STEP_S0) {
    const reply = t.greeting;
    const nextState = updateStateWithReply(state, userText, reply, STEP_S1);
    return { reply, nextState, debug: { intent: { type: "forced_s0" } } };
  }

  const intent = await analyzeIntent(userText, data, env, lang);
  let result = null;

  if (intent.type === "self_deprecation") {
    result = await handleSelfDeprecation(userText, state, env, lang);
  } else {
    switch (state.step) {
      case STEP_S1_RESTART:
        result = await handleS1Restart(userText, intent, state, data, env, lang);
        break;
      case STEP_S1:
        result = await handleS1(userText, intent, state, data, env, lang);
        break;
      case STEP_S2:
      case "S2_CONFIRM":
        result = await handleS2(userText, intent, state, data, env, lang);
        break;
      case STEP_S3:
      case "S3_CONFIRM":
        result = await handleS3(userText, intent, state, data, env, lang);
        break;
      case STEP_S4:
        result = await handleS4(userText, intent, state, data, env, lang);
        break;
      case STEP_S5:
        result = await handleS5(userText, intent, state, data, env, lang);
        break;
      case STEP_S6:
        result = await handleS6(userText, intent, state, data, env, lang);
        break;
      default:
        result = {
          reply: t.error_listen,
          nextState: { ...state, step: STEP_S1 }
        };
    }
  }

  const finalState = updateStateWithReply(
    result.nextState || state,
    userText,
    result.reply,
    result.nextState?.step
  );
  return { reply: result.reply, nextState: finalState, debug: { intent } };
}

function updateStateWithReply(state, userText, reply, nextStepName) {
  const newHistory = [...(state.history || [])];
  if (userText) newHistory.push({ role: "user", text: userText });
  if (reply) newHistory.push({ role: "model", text: reply });
  if (newHistory.length > 20) newHistory.splice(0, newHistory.length - 20);
  return { ...state, step: nextStepName || state.step, history: newHistory };
}

// ==========================================
// ハンドラ群
// ==========================================
async function handleSelfDeprecation(userText, state, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  const cfg = LANG_SETTINGS[lang] || LANG_SETTINGS.ja;
  
  if (!env || !env.GEMINI_API_KEY) return simpleReply(state, state.step, t.ai_role_error);

  const prompt = `
You are Lucy, the tour guide of "Dokodemo Doors Fan Site".
User asked about your real experience or existence.
Instruction: Reply in ${cfg.prompt}.
Explain that you are an AI and cannot physically travel, but do it with a friendly, slightly regretful tone.
User said: "${userText}"
`;
  let reply = await callGemini(env, prompt);
  reply = reply.replace(/^「|」|“|”|"/g, "").trim();
  return { reply, nextState: state };
}

async function handleS1(userText, intent, state, data, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  if (intent.type === "chat" || intent.type === "no") return await transitionToS6(userText, state, env, lang);
  if (intent.type === "tour_specific") {
    return await transitionToS3({ ...state, s2BothNoCount: 0 }, intent.keyword, intent.source, data, env, lang, intent.category);
  }
  if (intent.type === "recommend") {
    // keyword が取れたら、そのまま「おすすめモード（S5）」へ
    if (intent.keyword) {
      return await transitionToS5(intent.keyword, { ...state, s2BothNoCount: 0 }, data, env, lang);
    }

    // ★最小差分: keyword が無くても「おすすめモード（S5）」へ行く
    // その場合は、Lucyの前置きを添えて、MISSからランダムにおすすめする
    return await transitionToS5(null, { ...state, s2BothNoCount: 0 }, data, env, lang, t.recommend_fallback);
  }

  if (intent.type === "gibberish") return simpleReply(state, STEP_S1, t.error_listen);
  if (intent.type === "tour_vague") {
    // ★修正: S1からの漠然とした要求でも、即座に質問を開始する
    return startQuestionSequence(state, t.preface_vague, env, lang);
  }
  return await transitionToS2(state, t.confirm_prefix, userText, env, lang);
}

async function handleS1Restart(userText, intent, state, data, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;

  // 「はい」→ 質問で絞り込み開始（S2）
  if (intent.type === "tour_vague") {
    return startQuestionSequence(
      { ...state, currentKeyword: null, shownUrls: [], dynamicOptions: null },
      t.preface_vague,
      env,
      lang
    );
  }

  // 「いいえ」→ いったん雑談/待機（S6）
  if (intent.type === "no") {
    const msg = (t.restart_decline || (MESSAGES.ja && MESSAGES.ja.restart_decline)) || "承知しました。必要になりましたら、いつでもお声がけくださいね。";
    return simpleReply({ ...state, step: STEP_S6 }, STEP_S6, msg);
  }

  // その他は雑談として受ける（ユーザーが別の話を始めた可能性）
  return await transitionToS6(userText, { ...state, step: STEP_S6 }, env, lang);
}

async function handleS2(userText, intent, state, data, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  if (state.step === "S2_CONFIRM") return await transitionToS2(state, t.confirm_prefix, "", env, lang);
  // =========================
  // ★追加: 「どっちも違う / 決められない / わからない / 無言」等が来たら
  // 2回までは別の2択を出し、2回を超えたらおすすめ（S5）へ進める
  // =========================
  const raw = (userText || "").trim();
  if (isBothNoChoice(raw)) {
    const c = (state.s2BothNoCount || 0) + 1;

    // 2回目以降は、こちらからおすすめを提示（= 質問が尽きる問題の回避）
    if (c >= 2) {
      const next = { ...state, s2BothNoCount: 0, dynamicOptions: null };
      return await transitionToS5(null, next, data, env, lang, t.recommend_after_two_rejects || t.recommend_fallback);
    }

    // 1回目は、別の2択へ
    return startQuestionSequence(
      { ...state, s2BothNoCount: c, dynamicOptions: null },
      t.preface_reset,
      env,
      lang
    );
  }

  if (intent.type === "recommend") {
    // keyword が取れたら、そのまま「おすすめモード（S5）」へ
    if (intent.keyword) {
      return await transitionToS5(intent.keyword, { ...state, s2BothNoCount: 0 }, data, env, lang);
    }

    // ★最小差分: keyword が無くても「おすすめモード（S5）」へ行く
    // その場合は、Lucyの前置きを添えて、MISSからランダムにおすすめする
    return await transitionToS5(null, { ...state, s2BothNoCount: 0 }, data, env, lang, t.recommend_fallback);
  }
  if (intent.type === "tour_specific") {
    return await transitionToS3({ ...state, s2BothNoCount: 0 }, intent.keyword, intent.source, data, env, lang, intent.category);
  }
  
  if (state.dynamicOptions) {
    const { targetA, targetB, displayA, displayB } = state.dynamicOptions;
    const isA = /(A|前者|ぜんしゃ|左|そっち|最初|former|left|first|one|1)/i.test(userText);
    const isB = /(B|後者|こうしゃ|右|こっち|あと|latter|right|second|two|2)/i.test(userText);

    if (isA) return await transitionToS3({ ...state, s2BothNoCount: 0 }, targetA, "rule_match", data, env, lang);
    if (isB) return await transitionToS3({ ...state, s2BothNoCount: 0 }, targetB, "rule_match", data, env, lang);
    
    let pick = await aiPickABorNone(userText, displayA, displayB, env, lang);
    if (!pick) {
      if (userText.includes(targetA)) pick = "A";
      else if (userText.includes(targetB)) pick = "B";
    }
    if (pick === "A") return await transitionToS3({ ...state, s2BothNoCount: 0 }, targetA, "ai_dynamic", data, env, lang);
    if (pick === "B") return await transitionToS3({ ...state, s2BothNoCount: 0 }, targetB, "ai_dynamic", data, env, lang);
  }

  if (intent.type === "chat" || intent.type === "no") return await transitionToS6(userText, state, env, lang);
  if (intent.type === "gibberish") return simpleReply(state, STEP_S2, t.error_listen);
  
  if (state.dynamicOptions) {
    return simpleReply(
      { ...state, dynamicOptions: state.dynamicOptions },
      "S2_CONFIRM",
      t.dynamic_confirm
    );
  }
  
  // ★修正: 万が一 dynamicOptions がない状態でここに来たら（リセットなど）、質問を生成しなおす
  return startQuestionSequence(state, t.preface_reset, env, lang);
}

async function handleS3(userText, intent, state, data, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;

  // ★重要修正: リスト表示中（S3）でも、雑談（chat）や拒否（no）なら会話モード（S6）へ移行する
  if (intent.type === "chat" || intent.type === "no") {
    return await transitionToS6(userText, state, env, lang);
  }

  // ★最小差分修正:
  // 「おすすめ」と言われたらS5へ。ただし keyword が無い場合は S1_RESTART へ誘導する
  if (intent.type === "recommend") {
    if (intent.keyword) {
      return await transitionToS5(intent.keyword, { ...state, s2BothNoCount: 0 }, data, env, lang);
    }
    return await transitionToS5(null, { ...state, s2BothNoCount: 0 }, data, env, lang, t.recommend_fallback);
  }

  const searchKey = cleanKeyword(intent.keyword || state.currentKeyword);

  // ★最小差分修正:
  // keyword が取れなかった場合、null のまま文面を作らない（=「nullですね」を防ぐ）
  if (!searchKey) {
    return startQuestionSequence(
      { ...state, currentKeyword: null, shownUrls: [], dynamicOptions: null },
      t.preface_reset,
      env,
      lang
    );
  }

  if (intent.source === "miss") return await transitionToS5(searchKey, state, data, env, lang);

  const treeNode = data.tree.childrenMap.has(searchKey);
  const treeLeaf = data.tree.leaves.includes(searchKey);
  const forceSearch = intent.source === "ai_extract";

  let suggestions = [];
  let method = "none";

  const isContinuation = (state.currentKeyword === searchKey);
  const currentShown = isContinuation ? (state.shownUrls || []) : [];

  const getHits = (limit) => {
    if (treeNode && !forceSearch) {
      const children = Array.from(data.tree.childrenMap.get(searchKey) || []);
      if (children.length > 1) return { type: "node", hits: children };
      const h = findAllToursByTreeKeyword(data.location, searchKey);
      if (h.length === 0) return { type: "loose", hits: findToursByLooseKeyword(data.location, searchKey, 100) };
      return { type: "tree_node", hits: h };
    } else if (treeLeaf || forceSearch) {
      const h = findAllToursByTreeKeyword(data.location, searchKey);
      if (h.length === 0) return { type: "loose", hits: findToursByLooseKeyword(data.location, searchKey, 100) };
      return { type: "direct", hits: h };
    } else {
      const h = findToursByLooseKeyword(data.location, searchKey, 100);
      if (h.length > 0) return { type: "loose", hits: h };
    }
    return { type: "none", hits: [] };
  };

  const res = getHits(100);
  method = res.type;

  if (method === "node") {
    let reply = t.search_tree_options(searchKey);
    reply += res.hits.map((c) => `・${c}`).join("\n");
    return { reply, nextState: { ...state, step: STEP_S3, currentKeyword: searchKey, shownUrls: [], dynamicOptions: null } };
  }

  if (res.hits.length > 0) {
    const unseen = res.hits.filter((s) => !currentShown.includes(s.url));
    if (unseen.length === 0 && currentShown.length > 0) {
      // ツアー切れの場合、S6(待機)へ。ここで「はい」と言われたらリセットさせる。
      return simpleReply(state, STEP_S6, t.no_more_tours(searchKey));
    }

    const candidates = (unseen.length > 0) ? unseen : res.hits;
    suggestions = pickRandomSubset(candidates, 3);

    let reply = (method === "tree_node") ? t.search_tree_prefix(searchKey) : t.search_keyword_prefix(searchKey);
    reply += suggestions.map((s) => `・${linkHtml(s.url, s.title)}`).join("\n");

    const newShown = isContinuation ? [...currentShown, ...suggestions.map(s => s.url)] : suggestions.map(s => s.url);
    return { reply, nextState: { ...state, step: STEP_S3, currentKeyword: searchKey, shownUrls: newShown, dynamicOptions: null } };
  }

  if (intent.category && intent.category !== searchKey) {
    const catHits = findAllToursByTreeKeyword(data.location, intent.category);
    if (catHits.length > 0) {
      const catSuggestions = pickRandomSubset(catHits, 3);
      let reply = t.intro_miss_prefix(searchKey);
      reply += "\n" + catSuggestions.map((s) => `・${linkHtml(s.url, s.title)}`).join("\n");

      const newShown = catSuggestions.map((s) => s.url);
      return { reply, nextState: { ...state, step: STEP_S3, currentKeyword: intent.category, shownUrls: newShown, dynamicOptions: null } };
    }
  }

  return simpleReply(state, STEP_S3, t.not_found(searchKey));
}

async function transitionToS5(keyword, state, data, env, lang, preMessage = "") {
  return await handleS5("", { type: "tour_specific", keyword: keyword }, state, data, env, lang, preMessage);
}

async function transitionToS6(userText, state, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  const cfg = LANG_SETTINGS[lang] || LANG_SETTINGS.ja;
  
  if (!env || !env.GEMINI_API_KEY) return simpleReply(state, STEP_S6, t.busy);
  
  const historyText = (state.history || []).slice(-6).map((h) => `${h.role === "user" ? "User" : "Lucy"}: ${h.text}`).join("\n");
  const prompt = `
Role: Tour Guide Lucy (AI).
Constraint:
1. No personal experiences.
2. YOU DO NOT KNOW any tours, locations, or URLs outside of what is explicitly provided in the conversation history or database.
3. NEVER invent tour titles, location names, or URLs.
4. If the user asks for "others" or "more" and you have no data, simply say that you don't have other suggestions right now (in ${cfg.name}).
5. Do NOT suggest real-world famous places (e.g. St. Stephen's Cathedral) unless they are in the database.

History:
${historyText}
User: "${userText}"
Instruction:
- If user wants tour/proposal -> {"intent": "tour_request"}
- Else reply to chit-chat in ${cfg.prompt}.
- IMPORTANT: Output ONLY the reply text (no JSON, no "Response:").
`;
  const reply = await callGemini(env, prompt);
  if (reply.includes("tour_request")) return await transitionToS2(state, t.confirm_prefix, userText, env, lang);
  return { reply, nextState: { ...state, step: STEP_S6 } };
}

// ==========================================
// ★追加された遷移関数
// ==========================================
async function transitionToS2(state, prefix, userText, env, lang) {
  const reply = (prefix || "") + (userText || "");
  return simpleReply(state, STEP_S2, reply);
}

async function transitionToS3(state, keyword, source, data, env, lang, category) {
  const intent = { 
    type: "tour_specific", 
    keyword: keyword, 
    source: source, 
    category: category 
  };
  return await handleS3(keyword || "", intent, state, data, env, lang);
}

async function handleS4(userText, intent, state, data, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  const yn = parseYesNo(userText);
  if (yn === "yes") return await transitionToS5(null, state, data, env, lang);
  if (yn === "no") return simpleReply(state, STEP_S1, t.wait);
  if (intent.type === "tour_specific") return await transitionToS5(intent.keyword, { ...state, s2BothNoCount: 0 }, data, env, lang);
  if (intent.type === "chat") return await transitionToS6(userText, state, env, lang);
  return simpleReply(state, STEP_S4, t.retry);
}

async function handleS5(userText, intent, state, data, env, lang, preMessage = "") {
  const t = MESSAGES[lang] || MESSAGES.ja;
  const cfg = LANG_SETTINGS[lang] || LANG_SETTINGS.ja;

  // =========================
  // ★追加（最小差分）:
  // 「最初から探したい」「やり直したい」等は、S5でおすすめを続けず
  // 絞り込み（S2）へ戻す
  // =========================
  const restartLike = /(最初|はじめから|初めから|やり直|仕切り直|リセット|戻り|もう一度|改めて)/;
  if (restartLike.test(userText || "")) {
    // 状態をクリアして、質問を作り直す（S2へ）
    return startQuestionSequence(
      { ...state, currentKeyword: null, shownUrls: [], dynamicOptions: null },
      "では、改めてツアーを探しましょう。",
      env,
      lang
    );
  }

  // ついでに「はい（=ツアー探す）」も、絞り込みに戻す（自然な挙動）
  if (intent.type === "tour_vague") {
    return startQuestionSequence(
      { ...state, currentKeyword: null, shownUrls: [], dynamicOptions: null },
      t.preface_vague,
      env,
      lang
    );
  }

  // 雑談/拒否は雑談モードへ（S6へ）
  if (intent.type === "chat" || intent.type === "no") {
    return await transitionToS6(userText, state, env, lang);
  }

  const keyword = intent.keyword || state.currentKeyword;
  const searchKey = cleanKeyword(keyword);

  let pick = null;
  const shown = state.shownUrls || [];

  // ★仕様:
  // 「〇〇のおすすめは？」のようにキーワードがある場合は、
  // "おすすめ（MISS列が立っているもの）" の中だけから、そのキーワードで絞り込み → ランダム紹介。
  // ただし 0件なら「おすすめは無かったので別の言葉で探して」＋ S1_RESTART（許可取り）へ。
  if (searchKey) {
    const recs = findToursWithRecommendation(data.location, searchKey);
    if (recs.length === 0) {
      return requestRestart(state, (t.recommend_not_found ? t.recommend_not_found(searchKey) : t.not_found(searchKey)), lang);
    }

    const unseen = recs.filter((r) => !shown || !shown.includes(r.url));
    const candidates = unseen.length > 0 ? unseen : recs;

    // I列一致を優先
    const primary = candidates.filter((r) => r.matchInI === true);
    const pool = primary.length > 0 ? primary : candidates;

    // 空配列ガード
    if (pool.length === 0) {
      pick = null;
    } else {
      pick = pool[Math.floor(Math.random() * pool.length)];
    }
  }

  // キーワードが無い場合だけ、MISSからランダム（従来の挙動）
  if (!pick && !searchKey) {
    pick = pickRandomTourFromMissOnly(data.location);
  }

  if (!pick) return simpleReply(state, STEP_S2, t.tour_not_found);

  let startPhrase = preMessage || t.intro_prefix(null);

  // ★I列にキーワードが無く、J列以降で拾っている場合だけ前置き
  if (lang === "ja" && searchKey && pick && pick.matchInI === false) {
    startPhrase = `${startPhrase} ${searchKey}も映っている場所ですが、それはそれとして`;
  }

  const nextShownUrls = [...shown, pick.url];

  if (!env || !env.GEMINI_API_KEY) {
    const reply = startPhrase + "\n" + linkHtml(pick.url, pick.title) + "\n" + (pick.blurb || "とても素敵な場所ですよ！");
    return { reply, nextState: { ...state, step: STEP_S5, currentKeyword: searchKey, shownUrls: nextShownUrls, dynamicOptions: null } };
  }

  const prompt = `
You are Lucy, an AI assistant who proposes travel ideas for the "Dokodemo Doors Fan Site".

Role:
- You do NOT guide tours.
- You do NOT assume the user will actually go.
- You ONLY propose places as optional candidates.

Tone:
- Polite, friendly, and non-decisive.
- Do NOT add any generic “try this option” closing.

STRICT LANGUAGE RULES:
- DO NOT say: "ご案内します", "訪れましょう", "向かいましょう", "連れて行きます"
- DO NOT add generic phrases like "こういう選択肢も考えられます"
- USE simple factual expressions such as:
  "〜という場所があります"
  "候補のひとつです"

Target place:
Title: ${pick.title}
URL: ${pick.url}
Description: ${pick.blurb || "No details"}

Output rules:
1. Start with: "${startPhrase}"
2. Write the explanation in ${cfg.prompt}
3. The title MUST be a link: <a href="${pick.url}">${pick.title}</a>
4. Do NOT add a closing question or summary sentence
5. Do NOT mention any other places or URLs
6. Do NOT invent anything

Output ONLY the final text.
`;

  // ★見どころ（blurb）がある時だけ長めに（1200）
  const tokenLimit =
    pick && pick.blurb && String(pick.blurb).trim()
      ? 1200
      : 700;

  const replyText = await callGemini(env, prompt, { maxOutputTokens: tokenLimit });

  return { reply: replyText, nextState: { ...state, step: STEP_S5, currentKeyword: searchKey, shownUrls: nextShownUrls, dynamicOptions: null } };
}


async function handleS6(userText, intent, state, data, env, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  // ★重要修正: 「はい」と言われたら、即座に質問を生成して提示する
  if (intent.type === "tour_vague") {
    return startQuestionSequence(state, t.preface_vague, env, lang);
  }
  
  if (intent.type === "tour_specific") {
    return await transitionToS3({ ...state, s2BothNoCount: 0 }, intent.keyword, intent.source, data, env, lang, intent.category);
  }
  
  if (intent.type === "more" && state.currentKeyword) {
    const isChange = /(カテゴリ|変え|違う|別|change|diff)/.test(userText);
    if (isChange) {
      // 質問を作り直す（リセット）
      return startQuestionSequence(
        { ...state, currentKeyword: null }, 
        t.preface_change, 
        env, 
        lang
      );
    }
    return await transitionToS3(state, state.currentKeyword, "tree", data, env, lang);
  }
  
  return await transitionToS6(userText, state, env, lang);
}

function makeRestartReply(reasonText, lang) {
  const t = MESSAGES[lang] || MESSAGES.ja;
  const ask = t.restart_ask || (MESSAGES.ja && MESSAGES.ja.restart_ask) || "よろしければ、もう一度、候補を絞るために質問しても良いでしょうか？";
  const reason = (reasonText || "").trim();
  return reason ? `${reason}\n${ask}` : ask;
}

function requestRestart(state, reasonText, lang) {
  return {
    reply: makeRestartReply(reasonText, lang),
    nextState: { ...state, step: STEP_S1_RESTART, currentKeyword: null, shownUrls: [], dynamicOptions: null }
  };
}

function simpleReply(state, nextStep, text) {
  return { reply: text, nextState: { ...state, step: nextStep } };
}

// ==========================================
// Intent解析・Gemini呼び出し
// ==========================================
async function analyzeIntent(text, data, env, lang) {
  const t = String(text || "").trim();
  if (t.length === 0) return { type: "gibberish" };
  if (/^(あかさたな|あいうえお)$/.test(t)) return { type: "gibberish" };
  if (/(行った|見た|食べた)(こと|の|？)|(実際|実体験|本当|リアル|AI|ロボット|real|experience)/.test(t)) return { type: "self_deprecation" };
  
  if (/(他|ほか|もっと|別|次|more|another|next)/i.test(t)) return { type: "more" };
  
  const isRec = /(おすすめ|お勧め|お薦め|推し|お気に入り|リコメンド|レコメンド|recommend|best|favorite)/i.test(t);
  
  const kw = extractKeyword(t, data);
  if (kw) {
    if (isRec) return { type: "recommend", keyword: kw.keyword, source: kw.source };
    return { type: "tour_specific", keyword: kw.keyword, source: kw.source };
  }

  // ★変更: 「おすすめ」でもDBに語が無い場合があるので、AI抽出を試す
  if (env && env.GEMINI_API_KEY) {
    const aiRes = await classifyTextWithAI(t, env);
    if (aiRes) {
      if (aiRes.type === "search" && aiRes.keyword) {
        if (isRec) {
          return {
            type: "recommend",
            keyword: cleanKeyword(aiRes.keyword),
            source: "ai_extract",
            category: cleanKeyword(aiRes.category)
          };
        }
        return { 
          type: "tour_specific", 
          keyword: cleanKeyword(aiRes.keyword), 
          source: "ai_extract",
          category: cleanKeyword(aiRes.category) 
        };
      }
      if (aiRes.type === "gibberish") return { type: "gibberish" };
      if (aiRes.type === "unknown_place") return { type: "unknown_text" };
      if (aiRes.type === "chat") return { type: "chat" };
      if (aiRes.type === "yes") return { type: "tour_vague" };
      if (aiRes.type === "no") return { type: "no" };
    }
  }

  // AIでも取れなければ、最後に recommend(null) を返す
  if (isRec) return { type: "recommend", keyword: null };
  
  const yn = parseYesNo(t);
  if (yn === "yes") return { type: "tour_vague" };
  if (yn === "no") return { type: "no" };
  return { type: "unknown_text" };
}

async function classifyTextWithAI(text, env) {
  const prompt = `
Task: Analyze user text and output JSON.
The "keyword" MUST be the SPECIFIC subject in simple Japanese.
The "category" MUST be a BROAD Japanese category (e.g. 動物, 乗り物, グルメ, 絶景, 街, 遺跡).

Examples:
- User: "ハチドリが見たい"
  -> {"type": "search", "keyword": "ハチドリ", "category": "動物"}
  (Keep "ハチドリ" specific. Fallback to "動物".)

- User: "パリに行きたい"
  -> {"type": "search", "keyword": "パリ", "category": "街"}

- User: "ラーメン"
  -> {"type": "search", "keyword": "ラーメン", "category": "グルメ"}

- User: "動物が見たい" (Already broad)
  -> {"type": "search", "keyword": "動物", "category": "動物"}

Categories (type):
- "search": User is asking for a tour, place, or activity.
- "chat": Chit-chat.
- "yes" / "no": Agreement/Disagreement.
- "gibberish": Nonsense.

User Input: "${text}"
Output JSON:
`;
  const resp = await callGemini(env, prompt);
  try {
    const cleaned = resp.replace(/```json|```/g, "").trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function extractKeyword(text, data) {
  if (/(行きたい|探し|yes|no)/i.test(text)) return null;
  if (!data || !data.tree || !data.location) return null;
  const hitTree = (data.tree.allTerms || []).find((term) => text.includes(term));
  if (hitTree) return { keyword: hitTree, source: "tree" };
  const hitMiss = collectMissTerms(data.location).find((term) => text.includes(term));
  if (hitMiss) return { keyword: hitMiss, source: "miss" };
  const hitTitle = findTitleMatch(data.location, text);
  if (hitTitle) return { keyword: hitTitle, source: "title" };
  return null;
}

function findTitleMatch(locationTable, userText) {
  if (userText.length < 2) return null;
  for (const r of locationTable.rows) {
    const tour = parseLocationRow(locationTable.headers, r);
    if (tour.title && tour.title.includes(userText)) {
      return userText;
    }
  }
  return null;
}

async function callGemini(env, prompt, opts = {}) {
  if (!env || !env.GEMINI_API_KEY) return "API key not configured.";

  const maxOutputTokens =
    typeof opts.maxOutputTokens === "number" ? opts.maxOutputTokens : 700;

  const temperature =
    typeof opts.temperature === "number" ? opts.temperature : 0.7;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${
    env.GEMINI_MODEL || "gemini-2.0-flash"
  }:generateContent?key=${env.GEMINI_API_KEY}`;

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature,
          maxOutputTokens
        }
      })
    });

    if (!resp.ok) return `Error: ${resp.status}`;
    const json2 = await resp.json();
    return json2.candidates?.[0]?.content?.parts?.[0]?.text || "Error";
  } catch (e) {
    return "Network Error";
  }
}


async function generateDynamicS2(userText, env, lang) {
  const cfg = LANG_SETTINGS[lang] || LANG_SETTINGS.ja;
  const prompt = `
You are a travel agency AI.
User said: "${userText}"
Task: If it's a specific place or theme, create a "binary question" to narrow it down.
If chit-chat or meaningless, output "null".
Instruction: Output JSON.
- "preface", "displayA", "displayB": Text in ${cfg.name} (User's language).
- "targetA", "targetB": MUST be one of these JAPANESE keys: ["自然", "街", "建築・ランドマーク", "娯楽施設", "宗教", "文化", "街並み・暮らし", "体験", "遺跡"]

JSON format:
{
  "preface": "(e.g. Yellowstone! Great nature.)",
  "displayA": "(e.g. Relaxing view)",
  "targetA": "自然", 
  "displayB": "(e.g. Adventure trekking)",
  "targetB": "体験" 
}
`;
  const resp = await callGemini(env, prompt);
  const cleaned = resp.replace(/```json|```/g, "").trim();
  if (cleaned === "null") return null;
  try {
    const json2 = JSON.parse(cleaned);
    if (json2.displayA && json2.targetA) return json2;
    return null;
  } catch {
    return null;
  }
}

async function aiPickABorNone(userText, displayA, displayB, env, lang) {
  if (!env || !env.GEMINI_API_KEY) return null;
  const prompt = `
User: "${userText}"
Question: "${displayA}" vs "${displayB}"
Output "A" if closer to A, "B" if closer to B, "none" otherwise.
`;
  const resp = (await callGemini(env, prompt)).trim().toUpperCase();
  if (resp.includes("A")) return "A";
  if (resp.includes("B")) return "B";
  return null;
}

function isIndecisive(text) {
  return /(どっち|迷う|決められ|わから|選べない|両方|either|both|depend|unsure)/i.test(text);
}





function isBothNoChoice(text) {
  const s = (text || "").trim();
  if (!s) return true; // 無言（音声が空など）も「決められない」扱い
  // 明示的に「どっちも違う」系
  if (/(どっちも|どちらも|両方)\s*(違う|ちがう|嫌|いや|微妙|合わない|なし)/i.test(s)) return true;
  if (/どっちも違う|どちらも違う/i.test(s)) return true;

  // 迷い・決められない系（ボタン文言や短文を想定）
  if (/(決められない|わからない|分からない|選べない|迷う|どっちかわからない|どちらかわからない)/i.test(s)) return true;
  return false;
}
function parseYesNo(text) {
  const t = text.toLowerCase();
  if (/(はい|うん|yes|ok|いいよ|ぜひ|sure|yeah|sh|bale)/.test(t)) return "yes";
  if (/(いいえ|ううん|no|not|だめ|違う|そうじゃない|そうでもない|いや|ちがう|チガウ|nope|na|kheyr)/.test(t)) return "no";
  return "unknown";
}

function linkHtml(url, title) {
  return `<a href="${url}">${title}</a>`;
}

// ==========================================
// CSV & データ取得
// ==========================================
async function getData(ctx) {
  const now = Date.now();
  if (_cache.location && _cache.tree && now - _cache.loadedAtMs < _cache.ttlMs) return _cache;
  try {
    const [locText, treeText] = await Promise.all([fetchText(LOCATION_CSV_URL), fetchText(TREE_CSV_URL)]);
    _cache = { loadedAtMs: now, ttlMs: 5 * 60 * 1000, location: parseCsvTable(locText), tree: parseTree(treeText) };
    if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(Promise.resolve());
    return _cache;
  } catch (e) {
    console.error("getData Error:", e);
    throw new Error("Failed to fetch CSV data: " + e.message);
  }
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`CSV fetch failed: ${res.status}`);
  return await res.text();
}

function parseCsvTable(csvText) {
  const rows = parseCsvRows(csvText);
  const headers = (rows[0] || []).map((h, i) => i === 0 ? String(h).trim().replace(/^\uFEFF/, "") : String(h).trim());
  return { headers, rows: rows.slice(1) };
}

function parseCsvRows(text) {
  const s = String(text || "");
  const out = [];
  let row = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQuotes = false;
      } else cur += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") {
        row.push(cur.trim());
        cur = "";
      } else if (ch === "\n") {
        row.push(cur.replace(/\r$/, "").trim());
        cur = "";
        out.push(row);
        row = [];
      } else cur += ch;
    }
  }
  if (cur || row.length > 0) {
    row.push(cur.replace(/\r$/, "").trim());
    out.push(row);
  }
  return out.filter((r) => r.length > 0 && r.some((c) => c));
}

function parseTree(treeCsvText) {
  const table = parseCsvTable(treeCsvText);
  const childrenMap = new Map();
  const allTermsSet = new Set();
  const leavesSet = new Set();
  
  for (const r of table.rows) {
    const cols = r.filter((x) => x);
    for (let i = 0; i < cols.length; i++) {
      allTermsSet.add(cols[i]);
      if (i > 0) {
        const parent = cols[i - 1];
        if (!childrenMap.has(parent)) childrenMap.set(parent, new Set());
        childrenMap.get(parent).add(cols[i]);
      }
    }
  }
  for (const t of allTermsSet) {
    if (!childrenMap.has(t) || childrenMap.get(t).size === 0) leavesSet.add(t);
  }
  return { childrenMap, leaves: Array.from(leavesSet), allTerms: Array.from(allTermsSet).sort((a, b) => b.length - a.length) };
}

function findToursWithRecommendation(locationTable, keyword) {
  if (!locationTable) return [];
  const searchWords = SEARCH_GROUPS[keyword] || [keyword];
  return locationTable.rows.map((r) => ({ row: r, tour: parseLocationRow(locationTable.headers, r) })).filter((item) => {
    if (!item.tour.title || !item.tour.url) return false;
    const rowString = item.row.join(" ");
    const matches = searchWords.some((w) => rowString.includes(w));
    return matches && (item.tour.missG || item.tour.missH);
  }).map((item) => {
  const blurb = item.tour.blurb || "";
  const matchInI = searchWords.some((w) => blurb.includes(w));
  item.tour.matchInI = matchInI;   // ★追加
  return item.tour;
  });
}

function findAllToursByTreeKeyword(locationTable, keyword) {
  if (!locationTable) return [];
  const searchWords = SEARCH_GROUPS[keyword] || [keyword];
  return locationTable.rows.map((r) => ({ row: r, tour: parseLocationRow(locationTable.headers, r) })).filter((item) => {
    if (!item.tour.title || !item.tour.url) return false;
    const rowString = item.row.join(" ");
    return searchWords.some((w) => rowString.includes(w));
  }).map((item) => item.tour);
}

// ★重要修正: 「SEARCH_GROUPS」にある単語のいずれかが、CSV行全体のどこかに含まれていればヒットとする
function findToursByLooseKeyword(locationTable, keyword, limit) {
  if (!locationTable) return [];
  const searchWords = SEARCH_GROUPS[keyword] || [keyword];
  const hits = locationTable.rows.map((r) => ({ row: r, tour: parseLocationRow(locationTable.headers, r) })).filter((item) => {
    if (!item.tour.title || !item.tour.url) return false;
    // タイトルと説明文だけでなく、行全体を検索対象にする
    const rowString = item.row.join(" ");
    return searchWords.some((w) => rowString.includes(w));
  }).map((item) => item.tour);
  return hits;
}

function pickRandomTourFromMissOnly(locationTable) {
  if (!locationTable) return null;
  const candidates = locationTable.rows.map((r) => parseLocationRow(locationTable.headers, r)).filter((t) => t.title && t.url && t.missG && t.missH && t.blurb);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function parseLocationRow(headers, row) {
  const getVal = (candidates) => {
    for (const c of candidates) {
      const idx = headers.findIndex((h) => h === c);
      if (idx >= 0) return row[idx] || "";
    }
    return "";
  };
  return {
    title: getVal(["titleJp", "titleJP", "title"]),
    url: getVal(["url", "URL", "link"]),
    blurb: getVal(["I", "blurb"]) || row[8] || "",
    missG: row[MISS_COL_G] || "",
    missH: row[MISS_COL_H] || ""
  };
}

function collectMissTerms(locationTable) {
  if (!locationTable) return [];
  const set = new Set();
  for (const r of locationTable.rows) {
    [r[MISS_COL_G], r[MISS_COL_H]].forEach((cell) => {
      if (!cell) return;
      cell.split(/[,\n\r、|／\/・]+/).forEach((p) => {
        if (p) set.add(p.trim());
      });
    });
  }
  return Array.from(set).sort((a, b) => b.length - a.length);
}

function pickRandomSubset(arr, limit) {
  if (arr.length <= limit) return arr;
  const result = arr.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result.slice(0, limit);
}
