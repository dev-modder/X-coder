const {
    proto,
    downloadContentFromMessage,
    getContentType
} = require('@whiskeysockets/baileys')
const fs = require('fs').promises;
const { writeFileSync, readFileSync } = require('fs');

const downloadMediaMessage = async (m, filename) => {
    if (m.type === 'viewOnceMessageV2') {
        m.type = getContentType(m.msg);
    }
    const messageType = m.type.replace('Message', '');
    const acceptedTypes = ['image', 'video', 'audio', 'sticker', 'document'];
    
    if (!acceptedTypes.includes(messageType)) return null;

    const stream = await downloadContentFromMessage(m.msg, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
        buffer = Buffer.concat([buffer, chunk]);
    }

    if (filename) {
        let ext = 'bin';
        if (m.type === 'imageMessage') ext = 'jpg';
        else if (m.type === 'videoMessage') ext = 'mp4';
        else if (m.type === 'audioMessage') ext = 'mp3';
        else if (m.type === 'stickerMessage') ext = 'webp';
        else if (m.type === 'documentMessage') {
            ext = m.msg.fileName?.split('.').pop().toLowerCase() || 'bin';
        }
        const fullFilename = `${filename}.${ext}`;
        writeFileSync(fullFilename, buffer);
        return buffer;
    }
    return buffer;
}

const sms = (conn, m) => {
    if (!m) return m;
    if (m.key) {
        m.id = m.key.id;
        m.chat = m.key.remoteJid;
        m.fromMe = m.key.fromMe;
        m.isGroup = m.chat.endsWith('@g.us');
        m.sender = m.fromMe ? (conn.user.id.split(':')[0] + '@s.whatsapp.net') : (m.isGroup ? m.key.participant : m.key.remoteJid);
    }
    if (m.message) {
        m.type = getContentType(m.message);
        m.msg = (m.type === 'viewOnceMessage' || m.type === 'viewOnceMessageV2') ? 
            m.message[m.type].message[getContentType(m.message[m.type].message)] : 
            m.message[m.type];
        
        if (m.msg) {
            const contextInfo = m.msg.contextInfo || {};
            const quotedMention = contextInfo.participant || '';
            const tagMention = contextInfo.mentionedJid || [];
            m.mentionUser = [...tagMention, quotedMention].filter(Boolean);
            
            m.body = (m.type === 'conversation') ? m.msg : 
                     (m.type === 'extendedTextMessage') ? m.msg.text : 
                     (m.msg.caption) ? m.msg.caption : 
                     (m.type === 'templateButtonReplyMessage') ? m.msg.selectedId : 
                     (m.type === 'buttonsResponseMessage') ? m.msg.selectedButtonId : '';
            
            m.quoted = contextInfo.quotedMessage ? contextInfo.quotedMessage : null;
            if (m.quoted) {
                m.quoted.type = getContentType(m.quoted);
                m.quoted.id = contextInfo.stanzaId;
                m.quoted.sender = contextInfo.participant;
                m.quoted.fromMe = m.quoted.sender?.includes(conn.user.id.split(':')[0]);
                m.quoted.msg = (m.quoted.type === 'viewOnceMessage' || m.quoted.type === 'viewOnceMessageV2') ? 
                    m.quoted[m.quoted.type].message[getContentType(m.quoted[m.quoted.type].message)] : 
                    m.quoted[m.quoted.type];
                
                const qContext = m.quoted.msg?.contextInfo || {};
                m.quoted.mentionUser = [...(qContext.mentionedJid || []), (qContext.participant || '')].filter(Boolean);
                
                m.quoted.fakeObj = proto.WebMessageInfo.fromObject({
                    key: {
                        remoteJid: m.chat,
                        fromMe: m.quoted.fromMe,
                        id: m.quoted.id,
                        participant: m.quoted.sender
                    },
                    message: m.quoted
                });
                m.quoted.download = (path) => downloadMediaMessage(m.quoted, path);
                m.quoted.delete = () => conn.sendMessage(m.chat, { delete: m.quoted.fakeObj.key });
                m.quoted.react = (emoji) => conn.sendMessage(m.chat, { react: { text: emoji, key: m.quoted.fakeObj.key } });
            }
        }
        m.download = (path) => downloadMediaMessage(m, path);
    }

    m.reply = (text, id = m.chat, options = {}) => conn.sendMessage(id, { 
        text, 
        contextInfo: { mentionedJid: options.mentions || [m.sender] } 
    }, { quoted: m });

    m.react = (emoji) => conn.sendMessage(m.chat, { react: { text: emoji, key: m.key } });

    return m;
}

module.exports = { sms, downloadMediaMessage };
