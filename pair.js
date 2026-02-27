require('dotenv').config();
const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const cheerio = require('cheerio');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const { sms, downloadMediaMessage } = require("./msg");
const FileType = require('file-type');
const os = require('os');
const yts = require('yt-search');

const {
    default: makeWASocket,
    useMultiFileAuthState,
    delay,
    getContentType,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    downloadContentFromMessage,
    proto,
    prepareWAMessageMedia,
    generateWAMessageFromContent,
    S_WHATSAPP_NET
} = require('@whiskeysockets/baileys');

const config = require('./config');

// MongoDB Connection
const connectMongoDB = async () => {
    try {
        if (!config.MONGODB_URI) throw new Error('MONGODB_URI is missing in config');
        await mongoose.connect(config.MONGODB_URI);
        console.log('✅ Connected to MongoDB successfully');
    } catch (error) {
        console.error('❌ MongoDB connection failed:', error.message);
    }
};
connectMongoDB();

const sessionSchema = new mongoose.Schema({
    number: { type: String, required: true, unique: true },
    creds: { type: mongoose.Schema.Types.Mixed, required: true },
    config: { type: mongoose.Schema.Types.Mixed, default: {} },
    lastActive: { type: Date, default: Date.now }
}, { timestamps: true });

const Session = mongoose.model('Session', sessionSchema);
const activeSockets = new Map();
const socketCreationTime = new Map();
const SESSION_BASE_PATH = config.SESSION_BASE_PATH || './sessions';
const otpStore = new Map();

if (!fs.existsSync(SESSION_BASE_PATH)) fs.mkdirSync(SESSION_BASE_PATH, { recursive: true });

function formatMessage(title, content, footer) {
    return `*${title}*\n\n${content}\n\n> *${footer}*`;
}

async function setupStatusHandlers(socket) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const message = messages[0];
        if (!message?.key || message.key.remoteJid !== 'status@broadcast') return;
        try {
            if (config.AUTO_VIEW_STATUS === 'true') await socket.readMessages([message.key]);
            if (config.AUTO_LIKE_STATUS === 'true') {
                const emoji = Array.isArray(config.AUTO_LIKE_EMOJI) ? config.AUTO_LIKE_EMOJI[Math.floor(Math.random() * config.AUTO_LIKE_EMOJI.length)] : '❤️';
                await socket.sendMessage(message.key.remoteJid, { react: { text: emoji, key: message.key } }, { statusJidList: [message.key.participant] });
            }
        } catch (e) { console.error('Status Error:', e.message); }
    });
}

function setupCommandHandlers(socket, number) {
    socket.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.remoteJid === 'status@broadcast') return;

        const type = getContentType(msg.message);
        const body = (type === 'conversation') ? msg.message.conversation : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage.text : (type === 'imageMessage') ? msg.message.imageMessage.caption : (type === 'videoMessage') ? msg.message.videoMessage.caption : '';
        const prefix = config.PREFIX || '.';
        const isCmd = body.startsWith(prefix);
        const command = isCmd ? body.slice(prefix.length).trim().split(' ').shift().toLowerCase() : '';
        const args = body.trim().split(/ +/).slice(1);
        const from = msg.key.remoteJid;

        if (!isCmd) return;

        switch (command) {
            case 'ping': {
                const start = Date.now();
                await socket.sendMessage(from, { text: 'Testing Speed...' });
                await socket.sendMessage(from, { text: `🚀 Speed: ${Date.now() - start}ms` });
                break;
            }

            case 'play':
            case 'song': {
                const query = args.join(' ');
                if (!query) return socket.sendMessage(from, { text: '❌ Please provide a song name!' });
                
                await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
                try {
                    const search = await yts(query);
                    const video = search.videos[0];
                    if (!video) return socket.sendMessage(from, { text: '❌ Song not found!' });

                    const res = await axios.get(`https://api.dreaded.site/api/ytdl/video?url=${encodeURIComponent(video.url)}`);
                    const downloadUrl = res.data.result.download_url;

                    await socket.sendMessage(from, {
                        audio: { url: downloadUrl },
                        mimetype: 'audio/mpeg',
                        contextInfo: {
                            externalAdReply: {
                                title: video.title,
                                body: 'M O O N  X M D  P L A Y E R',
                                thumbnailUrl: video.thumbnail,
                                sourceUrl: video.url,
                                mediaType: 1,
                                renderLargerThumbnail: true
                            }
                        }
                    }, { quoted: msg });
                } catch (e) {
                    socket.sendMessage(from, { text: '❌ Error: ' + e.message });
                }
                break;
            }

            case 'menu': {
                const menu = formatMessage('M O O N  X M D  M E N U', `User: ${number}\nPrefix: ${prefix}\nCommands: play, ping, menu, alive`, 'Keith Tech');
                await socket.sendMessage(from, { text: menu }, { quoted: msg });
                break;
            }
        }
    });
}

async function EmpirePair(number, res) {
    const sanitizedNumber = number.replace(/[^0-9]/g, '');
    const sessionPath = path.join(SESSION_BASE_PATH, `session_${sanitizedNumber}`);
    const { state, saveCreds } = await useMultiFileAuthState(sessionPath);

    const socket = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })) },
        printQRInTerminal: false,
        browser: Browsers.macOS('Safari')
    });

    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            activeSockets.set(sanitizedNumber, socket);
            console.log(`✅ ${sanitizedNumber} Connected`);
            setupCommandHandlers(socket, sanitizedNumber);
            setupStatusHandlers(socket);
        }
        if (connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== 401;
            if (shouldReconnect) EmpirePair(number, res);
        }
    });

    if (!socket.authState.creds.registered) {
        setTimeout(async () => {
            try {
                const code = await socket.requestPairingCode(sanitizedNumber);
                if (res && !res.headersSent) res.send({ code });
            } catch (e) { console.error(e); }
        }, 3000);
    }
}

router.get('/', (req, res) => {
    if (req.query.number) EmpirePair(req.query.number, res);
    else res.status(400).send({ error: 'Number required' });
});

module.exports = router;
