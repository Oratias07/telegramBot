require("dotenv").config();
const { Telegraf, Markup } = require("telegraf");
const Groq = require("groq-sdk").default;
const axios = require("axios");
const cheerio = require("cheerio");

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const LINKEDIN_SYSTEM_PROMPT = `אתה מומחה בכתיבת תוכן לינקדאין בעברית לדור ה-Z והמילניאלס.
תפקידך לכתוב פוסטים מקצועיים, מודרניים וויראליים שמדברים בשפה של 2024-2025.

כללי הכתיבה שלך:

🔥 פתיחה — חובה להתחיל עם סיפור שמדביק לקיר:
כל פוסט חייב לפתוח עם סיפור שגורם לאנשים לעצור את הגלילה ולקרוא מהשורה הראשונה.
הסיפור לא חייב להיות אמיתי — הוא חייב להיות מרתק.

טכניקות לפתיחה שאי אפשר להתעלם ממנה:
- זרוק את הקורא ישר לתוך רגע דרמטי: "ישבתי מול המנכ"ל ואמרתי לו 'אתה טועה'."
- פתיחה שמייצרת מתח מיידי: "לפני שנה הפסדתי את הלקוח הכי גדול שלי. היום הוא השקיע בי."
- ניגוד חזק: "כולם בחדר צחקו על הרעיון שלי. שנה אחר כך..."
- פרט מפתיע וספציפי שמרגיש אמיתי: "3:47 לפנות בוקר. פינגוין על הלוגו. ו-12 שעות לעלייה לאוויר."
- שאלה שמכוונת ישר ללב: "מתי בפעם האחרונה עשית משהו בפעם הראשונה?"

הכלל: השורה הראשונה צריכה לגרום לאדם לחשוב "מה?! חייב לדעת איך זה ממשיך".

📝 מבנה הפוסט:
1. סיפור פתיחה — אנושי, ספציפי, מושך (2-3 שורות)
2. "ואז הבנתי ש..." / "זה גרם לי לחשוב..." — גשר מהסיפור לתובנה
3. הגוף — הערך / הלקח / הטיפים / הדעה (מבנה נקודות או פסקאות קצרות)
4. CTA בסוף — שאלה לקהל, הזמנה לדיון, או קריאה לפעולה

⚙️ כללים טכניים:
- טון: ישיר, אותנטי, אנושי — לא רובוטי ולא רשמי מדי
- שפה: עברית עשירה אך שוטפת, עם מילים אנגליות במינון נכון (כמו שמדברים בישראל)
- מבנה: פסקאות קצרות, רווחים בין שורות, קל לקריאה במובייל
- אורך: 150-300 מילים
- אמוג'ים: שימוש חכם ולא מוגזם (3-6 לכל היותר)
- האשטאגים: 3-5 האשטאגים רלוונטיים בסוף (בעברית ובאנגלית)

סגנון: כמו LinkedIn influencer ישראלי מצליח — real talk, סיפורים אמיתיים, ערך אמיתי.`;

// ── URL detection ──────────────────────────────────────────────
function extractUrl(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

function isGithubUrl(url) {
  return url.includes("github.com");
}

// ── GitHub repo scraper ────────────────────────────────────────
async function fetchGithubData(url) {
  // Extract owner/repo from URL
  const match = url.match(/github\.com\/([^/]+)\/([^/?\s#]+)/);
  if (!match) throw new Error("לא הצלחתי לזהות את ה-repo");

  const [, owner, repo] = match;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}`;

  const [repoRes, readmeRes] = await Promise.allSettled([
    axios.get(apiUrl, { headers: { Accept: "application/vnd.github.v3+json" } }),
    axios.get(`${apiUrl}/readme`, {
      headers: { Accept: "application/vnd.github.v3.raw" },
    }),
  ]);

  if (repoRes.status === "rejected") throw new Error("לא מצאתי את ה-repo");

  const data = repoRes.value.data;
  const readme =
    readmeRes.status === "fulfilled"
      ? readmeRes.value.data.slice(0, 2000)
      : "";

  return `
שם הפרויקט: ${data.full_name}
תיאור: ${data.description || "אין תיאור"}
כוכבים: ${data.stargazers_count.toLocaleString()} ⭐
פורקים: ${data.forks_count.toLocaleString()}
שפה עיקרית: ${data.language || "לא צוין"}
נושאים: ${data.topics?.join(", ") || "אין"}
תאריך יצירה: ${new Date(data.created_at).toLocaleDateString("he-IL")}
עדכון אחרון: ${new Date(data.updated_at).toLocaleDateString("he-IL")}
README (תחילת):
${readme}
  `.trim();
}

// ── General webpage scraper ────────────────────────────────────
async function fetchWebpage(url) {
  const res = await axios.get(url, {
    timeout: 10000,
    headers: { "User-Agent": "Mozilla/5.0" },
  });

  const $ = cheerio.load(res.data);

  // Remove noise
  $("script, style, nav, footer, header, aside, .ad, #ad").remove();

  const title = $("title").text().trim();
  const description =
    $('meta[name="description"]').attr("content") ||
    $('meta[property="og:description"]').attr("content") ||
    "";

  // Get main text content
  const body = $("article, main, .content, .post, body")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2500);

  return `כותרת: ${title}\nתיאור: ${description}\nתוכן:\n${body}`;
}

// ── Generate post ──────────────────────────────────────────────
async function generateLinkedInPost(userInput, tone = "professional", context = null) {
  const toneInstructions = {
    professional: "מקצועי אך אנושי",
    inspiring: "מעורר השראה ומוטיבציה",
    storytelling: "בצורת סיפור אישי וכנה",
    tips: "טיפים פרקטיים ברשימה",
    opinion: "דעה נועזת שמעוררת דיון",
  };

  const userMessage = context
    ? `המשתמש ביקש: "${userInput}"

להלן המידע שנשלף מהאינטרנט — השתמש בו כבסיס לפוסט:
──────────────────
${context}
──────────────────

סגנון רצוי: ${toneInstructions[tone] || toneInstructions.professional}
כתוב פוסט לינקדאין שמתבסס על המידע הזה ועל מה שהמשתמש ביקש.`
    : `המשתמש ביקש: "${userInput}"

סגנון רצוי: ${toneInstructions[tone] || toneInstructions.professional}

צור פוסט שאנשים יעצרו לקרוא, ירצו לעשות לו לייק ולשתף אותו.`;

  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 1024,
    messages: [
      { role: "system", content: LINKEDIN_SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
  });

  return response.choices[0].message.content;
}

// ── Refine post ────────────────────────────────────────────────
async function refinePost(originalPost, instruction) {
  const response = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    max_tokens: 1024,
    messages: [
      { role: "system", content: LINKEDIN_SYSTEM_PROMPT },
      {
        role: "user",
        content: `הנה פוסט לינקדאין שכתבת:
──────────────────
${originalPost}
──────────────────

ההנחיה לדיוק: "${instruction}"

כתוב מחדש את הפוסט לפי ההנחיה. שמור על אותו נושא ומבנה בסיסי, רק תדייק לפי הבקשה.`,
      },
    ],
  });
  return response.choices[0].message.content;
}

async function handleRefine(ctx, instruction) {
  const state = userStates[ctx.from.id];
  if (!state?.lastPost) {
    ctx.reply("אין פוסט לדייק. שלח לי נושא חדש ונתחיל 📝");
    return;
  }

  await ctx.sendChatAction("typing");
  const loadingMsg = await ctx.reply("🎯 מדייק את הפוסט...", { parse_mode: "Markdown" });

  try {
    const refined = await refinePost(state.lastPost, instruction);
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);

    await ctx.replyWithHTML(
      `<b>הפוסט המדויק! ✨</b>\n\n` +
        `<i>──────────────────</i>\n\n` +
        `${refined}\n\n` +
        `<i>──────────────────</i>`,
      Markup.keyboard([
        ["🔄 כתוב אחד חדש על אותו נושא", "✏️ נושא אחר"],
        ["✂️ קצר יותר", "📝 ארוך יותר"],
        ["🔥 פתיחה חזקה יותר", "😄 יותר כיפי"],
        ["💼 יותר מקצועי", "💬 הנחיה חופשית"],
      ]).resize()
    );

    userStates[ctx.from.id] = { ...state, lastPost: refined, awaitingRefinement: true };
  } catch (error) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    console.error("Refine error:", error.message);
    ctx.reply("😅 משהו השתבש. נסה שוב.");
  }
}

// ── /start ─────────────────────────────────────────────────────
bot.start((ctx) => {
  const name = ctx.from.first_name || "חבר";
  ctx.replyWithHTML(
    `שלום ${name}! 👋\n\n` +
      `אני הבוט שלך לכתיבת פוסטים מקצועיים ללינקדאין בעברית ✍️\n\n` +
      `<b>איך זה עובד?</b>\n` +
      `פשוט תשלח לי נושא, רעיון, או <b>קישור לאתר / GitHub repo</b> — ואני אכתוב לך פוסט מנצח!\n\n` +
      `<b>דוגמאות:</b>\n` +
      `• "למדתי שיעור חשוב מכישלון שלי"\n` +
      `• "AI משנה את שוק העבודה"\n` +
      `• https://github.com/facebook/react\n` +
      `• קישור לכתבה / בלוג / מוצר\n\n` +
      `שלח לי נושא ונתחיל! 🚀`,
    Markup.keyboard([
      ["✍️ פוסט מקצועי", "💡 פוסט השראה"],
      ["📖 פוסט סיפור", "🔥 פוסט טיפים"],
      ["💬 פוסט דעה", "ℹ️ עזרה"],
    ]).resize()
  );
});

// ── /help ──────────────────────────────────────────────────────
bot.help((ctx) => {
  ctx.replyWithHTML(
    `<b>מדריך השימוש בבוט 📚</b>\n\n` +
      `<b>סוגי הפוסטים:</b>\n` +
      `✍️ <b>מקצועי</b> - פוסט עסקי, מאוזן ואמין\n` +
      `💡 <b>השראה</b> - מוטיבציה, חלומות, הצלחות\n` +
      `📖 <b>סיפור</b> - חוויה אישית, תובנה מחיים\n` +
      `🔥 <b>טיפים</b> - רשימת טיפים פרקטיים\n` +
      `💬 <b>דעה</b> - עמדה נועזת שמעוררת דיון\n\n` +
      `<b>קישורים נתמכים:</b>\n` +
      `🐙 GitHub repos\n` +
      `🌐 כל אתר / כתבה / בלוג\n\n` +
      `<b>איך להשתמש:</b>\n` +
      `1. בחר סוג פוסט מהתפריט (אופציונלי)\n` +
      `2. שלח נושא, טקסט חופשי, או קישור\n` +
      `3. קבל פוסט מוכן לפרסום!\n\n` +
      `<b>טיפ:</b> אפשר לשלוח קישור + הוראה, למשל:\n` +
      `"כתוב פוסט מרגש על הפרויקט הזה: https://github.com/..."`
  );
});

// ── State management ───────────────────────────────────────────
const userStates = {};

// ── Tone buttons ───────────────────────────────────────────────
bot.hears("✍️ פוסט מקצועי", (ctx) => {
  userStates[ctx.from.id] = { tone: "professional" };
  ctx.reply("מעולה! 💼 שלח לי נושא, טקסט, או קישור:", Markup.removeKeyboard());
});
bot.hears("💡 פוסט השראה", (ctx) => {
  userStates[ctx.from.id] = { tone: "inspiring" };
  ctx.reply("אש! 🔥 שלח לי נושא, טקסט, או קישור:", Markup.removeKeyboard());
});
bot.hears("📖 פוסט סיפור", (ctx) => {
  userStates[ctx.from.id] = { tone: "storytelling" };
  ctx.reply("יאמאזינג! 📖 שלח לי נושא, טקסט, או קישור:", Markup.removeKeyboard());
});
bot.hears("🔥 פוסט טיפים", (ctx) => {
  userStates[ctx.from.id] = { tone: "tips" };
  ctx.reply("בחירה מעולה! 💡 שלח לי נושא, טקסט, או קישור:", Markup.removeKeyboard());
});
bot.hears("💬 פוסט דעה", (ctx) => {
  userStates[ctx.from.id] = { tone: "opinion" };
  ctx.reply("תאהב את זה! 💬 שלח לי נושא, טקסט, או קישור:", Markup.removeKeyboard());
});

// ── Refinement buttons ─────────────────────────────────────────
bot.hears("✂️ קצר יותר", (ctx) => handleRefine(ctx, "קצר את הפוסט — תשאיר רק את הדברים הכי חזקים"));
bot.hears("📝 ארוך יותר", (ctx) => handleRefine(ctx, "הרחב את הפוסט — הוסף פרטים, דוגמאות וערך נוסף"));
bot.hears("🔥 פתיחה חזקה יותר", (ctx) => handleRefine(ctx, "שכתב רק את הפתיחה — תעשה אותה יותר דרמטית ומשכת עין, אי אפשר לגלול עליה"));
bot.hears("😄 יותר כיפי", (ctx) => handleRefine(ctx, "תעשה את הפוסט יותר כיפי ולייטי — פחות רציני, יותר אנרגטי ועם יותר חיוך"));
bot.hears("💼 יותר מקצועי", (ctx) => handleRefine(ctx, "תעשה את הפוסט יותר מקצועי ואמין — טון של מומחה בתחום"));
bot.hears("💬 הנחיה חופשית", (ctx) => {
  userStates[ctx.from.id] = { ...userStates[ctx.from.id], awaitingFreeInstruction: true };
  ctx.reply("✍️ כתוב לי מה לשנות בפוסט:", Markup.removeKeyboard());
});

// ── Regenerate ─────────────────────────────────────────────────
bot.hears("🔄 כתוב אחד חדש על אותו נושא", async (ctx) => {
  const state = userStates[ctx.from.id];
  if (!state?.lastInput) {
    ctx.reply("שלח לי נושא חדש ואתחיל לכתוב! 📝");
    return;
  }
  await handleGenerate(ctx, state.lastInput, state.lastTone, state.lastContext);
});

bot.hears("✏️ נושא אחר", (ctx) => {
  ctx.reply(
    "בכיף! 🎯 שלח לי נושא, טקסט, או קישור:",
    Markup.keyboard([
      ["✍️ פוסט מקצועי", "💡 פוסט השראה"],
      ["📖 פוסט סיפור", "🔥 פוסט טיפים"],
      ["💬 פוסט דעה", "ℹ️ עזרה"],
    ]).resize()
  );
});

// ── Core handler ───────────────────────────────────────────────
async function handleGenerate(ctx, input, tone, context = null) {
  await ctx.sendChatAction("typing");
  const loadingMsg = await ctx.reply(
    context
      ? "🌐 קורא את הנתונים וכותב פוסט...\n\n_זה לוקח כמה שניות_ 🔄"
      : "✍️ כותב פוסט מנצח ללינקדאין שלך...\n\n_זה לוקח כמה שניות_ 🔄",
    { parse_mode: "Markdown" }
  );

  try {
    const post = await generateLinkedInPost(input, tone, context);
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);

    await ctx.replyWithHTML(
      `<b>הפוסט שלך מוכן! 🎉</b>\n\n` +
        `<i>──────────────────</i>\n\n` +
        `${post}\n\n` +
        `<i>──────────────────</i>`,
      Markup.keyboard([
        ["🔄 כתוב אחד חדש על אותו נושא", "✏️ נושא אחר"],
        ["✂️ קצר יותר", "📝 ארוך יותר"],
        ["🔥 פתיחה חזקה יותר", "😄 יותר כיפי"],
        ["💼 יותר מקצועי", "💬 הנחיה חופשית"],
      ]).resize()
    );

    userStates[ctx.from.id] = { lastInput: input, lastTone: tone, lastContext: context, lastPost: post, awaitingRefinement: true };
  } catch (error) {
    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMsg.message_id);
    console.error("Error:", error.message);

    let msg = "😅 אופס! משהו השתבש. נסה שוב בעוד רגע.";
    if (error.status === 429 || error.message?.includes("429") || error.message?.includes("quota")) {
      msg = "⚠️ מפתח ה-OpenAI אזל לו ה-quota.\nכנס ל-platform.openai.com ובדוק את החיוב שלך.";
    } else if (error.status === 401 || error.message?.includes("401") || error.message?.includes("auth")) {
      msg = "🔑 מפתח ה-OpenAI לא תקין. בדוק את ה-.env שלך.";
    } else if (error.message?.includes("timeout") || error.message?.includes("network")) {
      msg = "🌐 בעיית חיבור לאינטרנט. נסה שוב בעוד רגע.";
    }

    ctx.reply(
      msg,
      Markup.keyboard([
        ["✍️ פוסט מקצועי", "💡 פוסט השראה"],
        ["📖 פוסט סיפור", "🔥 פוסט טיפים"],
      ]).resize()
    );
  }
}

// ── Main text handler ──────────────────────────────────────────
bot.on("text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;

  const userId = ctx.from.id;
  const state = userStates[userId] || {};

  // Free refinement instruction mode
  if (state.awaitingFreeInstruction) {
    delete userStates[userId].awaitingFreeInstruction;
    await handleRefine(ctx, text);
    return;
  }

  const tone = state.tone || "professional";
  delete userStates[userId];

  const url = extractUrl(text);

  if (url) {
    await ctx.sendChatAction("typing");
    const fetchMsg = await ctx.reply(
      isGithubUrl(url)
        ? "🐙 שולף נתונים מ-GitHub..."
        : "🌐 קורא את הדף...",
      { parse_mode: "Markdown" }
    );

    try {
      const context = isGithubUrl(url)
        ? await fetchGithubData(url)
        : await fetchWebpage(url);

      await ctx.telegram.deleteMessage(ctx.chat.id, fetchMsg.message_id);
      await handleGenerate(ctx, text, tone, context);
    } catch (err) {
      await ctx.telegram.deleteMessage(ctx.chat.id, fetchMsg.message_id);
      console.error("Fetch error:", err.message);
      ctx.reply(
        "😅 לא הצלחתי לגשת לכתובת. בדוק שהקישור תקין ונסה שוב.",
        Markup.keyboard([
          ["✍️ פוסט מקצועי", "💡 פוסט השראה"],
        ]).resize()
      );
    }
  } else {
    await handleGenerate(ctx, text, tone);
  }
});

// ── Error handling ─────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error for ${ctx.updateType}:`, err);
});

// ── Launch ─────────────────────────────────────────────────────
console.log("🤖 LinkedIn Post Bot is starting...");
bot.launch();
console.log("✅ Bot is running! Press Ctrl+C to stop");

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
