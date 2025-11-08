// index.js

const { 
    makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason,
    downloadContentFromMessage, 
} 
= require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode-terminal');
const setting = require('./setting'); 
const { GoogleGenAI } = require('@google/genai');
const mammoth = require('mammoth'); 
const XLSX = require('xlsx'); 
const pptx2json = require('pptx2json'); 
const fs = require('fs'); 
const path = require('path');
// --- Pustaka Tambahan untuk QR Code ---
const Jimp = require('jimp'); 
const jsQR = require('jsqr'); 


// --- KONSTANTA BARU: Batas Ukuran File (Dua Batasan) ---
const MAX_DOC_SIZE_BYTES = 100 * 1024 * 1024;   // 100 MB untuk Dokumen
const MAX_MEDIA_SIZE_BYTES = 250 * 1024 * 1024; // 250 MB untuk Gambar & Video
// ----------------------------------------------------


const ai = setting.GEMINI_AI_INSTANCE;
const PREFIX = setting.PREFIX;
const CHAT_SESSIONS = setting.CHAT_SESSIONS; 
const GEMINI_MODEL_MAP = setting.GEMINI_MODEL_MAP;
const MODELS = setting.MODELS;
const SMART_MODE_SYSTEM_INSTRUCTION = setting.SMART_MODE_SYSTEM_INSTRUCTION; 
const GOOGLE_SEARCH_CONFIG = setting.GOOGLE_SEARCH_CONFIG; 
const PRIVATE_CHAT_STATUS = setting.PRIVATE_CHAT_STATUS; 


// --- FUNGSI BARU UNTUK DECODE QR CODE ---
async function decodeQrCode(buffer) {
    try {
        const image = await Jimp.read(buffer);
        const qrCode = jsQR(
            new Uint8ClampedArray(image.bitmap.data.buffer),
            image.bitmap.width,
            image.bitmap.height
        );

        if (qrCode) {
            return qrCode.data;
        } else {
            return null; 
        }
    } catch (error) {
        return null; 
    }
}


// --- FUNGSI BARU UNTUK MENGIRIM GAMBAR COMMAND (/norek) ---
async function handleSendImageCommand(sock, from, imagePath, caption) {
    try {
        await sock.sendPresenceUpdate('composing', from); 

        if (!fs.existsSync(imagePath)) {
            await sock.sendMessage(from, { text: `⚠️ Maaf, file gambar di path \`${imagePath}\` tidak ditemukan di server.` });
            return;
        }

        const imageBuffer = fs.readFileSync(imagePath);

        await sock.sendMessage(from, { 
            image: imageBuffer, 
            caption: caption || 'Informasi yang Anda minta.'
        });

    } catch (error) {
        console.error("Gagal memproses pengiriman gambar command:", error);
        await sock.sendMessage(from, { text: "Maaf, terjadi kesalahan saat mencoba mengirim gambar yang diminta." });
    } finally {
        await sock.sendPresenceUpdate('available', from); 
    }
}


// --- Fungsi Helper untuk Multimodal (Gambar, Video & Dokumen) - INLINE ---
function bufferToGenerativePart(buffer, mimeType) {
    if (!buffer || buffer.length === 0) {
        return null;
    }
    return {
        inlineData: {
            data: buffer.toString("base64"),
            mimeType
        },
    };
}


// --- Fungsi Helper untuk Multimodal (Gambar, Video & Dokumen) - URI (YouTube) ---
function uriToGenerativePart(uri, mimeType) {
    return {
        fileData: {
            fileUri: uri,
            mimeType: mimeType 
        },
    };
}


// --- Fungsi Helper Baru untuk Deteksi URL YouTube ---
function extractYoutubeUrl(text) {
    const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|watch\?.+&v=))([\w-]{11})(?:\S+)?/i;
    const match = text.match(youtubeRegex);
    
    if (match && match[0]) {
        return match[0]; 
    }
    return null;
}


/**
 * Fungsi untuk menyorot pola waktu (timestamp) di dalam teks.
 */
function highlightTimestamps(text) {
    const timestampRegex = /(\b\d{1,2}:\d{2}(:\d{2})?\b)|(\(\d{1,2}:\d{2}(:\d{2})?\))|(\[\d{1,2}:\d{2}(:\d{2})?\])/g;

    return text.replace(timestampRegex, (match) => {
        const cleanMatch = match.replace(/[\(\)\[\]]/g, '');
        return `*⏱️ \`${cleanMatch}\`*`; 
    });
}


// --- Fungsi Helper Ekstraksi Dokumen ---
async function extractTextFromDocument(buffer, mimeType) {
    // Efisiensi: File yang didukung native Gemini dikembalikan cepat
    if (mimeType === 'application/pdf' || mimeType === 'text/plain' || mimeType.startsWith('text/') || mimeType === 'application/json' || mimeType === 'application/javascript') {
        return null; 
    }

    // Ekstraksi DOCX/DOC (Mammoth)
    if (mimeType.includes('wordprocessingml.document') || mimeType === 'application/msword') {
        try {
            const result = await mammoth.extractRawText({ buffer: buffer });
            return `*Dokumen DOCX/DOC (Dikonversi ke Teks):*\n\n${result.value}`;
        } catch (error) {
            console.error("Gagal ekstraksi DOCX:", error);
            return "*[GAGAL EKSTRAKSI DARI DOCX/DOC]*. Coba lagi atau pastikan format file valid.";
        }
    } 
    // Ekstraksi XLSX/XLS (SheetJS)
    else if (mimeType.includes('spreadsheetml.sheet') || mimeType === 'application/vnd.ms-excel') {
        try {
            const workbook = XLSX.read(buffer, { type: 'buffer' });
            let allSheetText = "";

            workbook.SheetNames.forEach(sheetName => {
                const worksheet = workbook.Sheets[sheetName];
                const csv = XLSX.utils.sheet_to_csv(worksheet);
                const truncatedCsv = csv.substring(0, 10000); 

                allSheetText += `\n*-- SHEET: ${sheetName} (Dikonversi ke CSV) --*\n\`\`\`csv\n${truncatedCsv}\n\`\`\``;
            });

            return `*Dokumen XLSX/XLS (Data Dikonversi ke CSV):*\n${allSheetText}`;
        } catch (error) {
            console.error("Gagal ekstraksi XLSX:", error);
            return "*[GAGAL EKSTRAKSI DARI XLSX/XLS]*. Coba lagi atau pastikan format file valid.";
        }
    } 
    // Ekstraksi PPTX (pptx2json)
    else if (mimeType.includes('presentationml.presentation')) {
        try {
            const slidesData = await pptx2json.extract(buffer);
            let extractedText = "";

            slidesData.forEach((slide, index) => {
                const slideText = Array.isArray(slide.text) ? slide.text.join('\n') : slide.text;
                const notes = slide.notes || 'Tidak ada catatan pembicara.';

                extractedText += `\n\n*-- SLIDE ${index + 1} --*`;
                extractedText += `\n*Isi Slide:*\n${slideText || 'Tidak ada teks utama.'}`;
                extractedText += `\n*Catatan Pembicara:*\n${notes}`;
            });
            
            return `*Dokumen PPTX (Dikonversi ke Teks Per Slide):*\n${extractedText}`;

        } catch (error) {
            console.error("Gagal ekstraksi PPTX:", error);
            return "*[GAGAL EKSTRAKSI DARI PPTX]*. Coba lagi atau pastikan format file valid.";
        }
    }
    return `*Dokumen Tipe Tidak Dikenal:* ${mimeType}`;
}


// --- Fungsi Helper untuk Sesi Chat (Ingatan Otomatis & Tools) ---
function getOrCreateChat(jid) {
    const selectedModel = GEMINI_MODEL_MAP.get(jid) || MODELS.DEFAULT;
    
    if (CHAT_SESSIONS.has(jid)) {
        const chatInstance = CHAT_SESSIONS.get(jid);
        if (chatInstance.model !== selectedModel) {
            CHAT_SESSIONS.delete(jid); 
        } else {
             return chatInstance;
        }
    }

    let chatConfig = {
        config: {
            tools: setting.GOOGLE_SEARCH_CONFIG.apiKey && setting.GOOGLE_SEARCH_CONFIG.cx ? [{ googleSearch: setting.GOOGLE_SEARCH_CONFIG }] : [], 
            ...(selectedModel === MODELS.SMART && { systemInstruction: SMART_MODE_SYSTEM_INSTRUCTION })
        }
    };
    
    const chat = ai.chats.create({ model: selectedModel, ...chatConfig });
    chat.model = selectedModel; 
    CHAT_SESSIONS.set(jid, chat);
    return chat;
}

// --- FUNGSI HELPER UNTUK CEK MENTION (FINAL) ---
function isBotMentioned(m, sock) {
    if (!sock.user) return false; 
    
    const botJid = sock.user.id.split(':')[0] + '@s.whatsapp.net';
    const botJidRaw = sock.user.id.split(':')[0];

    const contextInfo = m.message?.extendedTextMessage?.contextInfo;
    const messageText = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || m.message.documentMessage?.caption || ''; 

    const mentionedJids = contextInfo?.mentionedJid || [];
    
    if (!m.key.remoteJid.endsWith('@g.us')) return false;

    return mentionedJids.includes(botJid) || 
           contextInfo?.participant === botJid || 
           messageText.includes('@' + botJidRaw);
}

// --- Fungsi Utama untuk Berbicara dengan Gemini (Ingatan Aktif dan Multimodal) ---
async function handleGeminiRequest(sock, from, textQuery, mediaParts = []) {
    try {
        await sock.sendPresenceUpdate('composing', from); 
        
        const hasMedia = mediaParts.length > 0;
        
        console.log(`[GEMINI] Memulai permintaan. Media: ${hasMedia ? mediaParts[0].inlineData?.mimeType || mediaParts[0].fileData?.mimeType : 'none'}`);

        // Dapatkan Waktu Server Saat Ini (WIB)
        const now = new Date();
        const serverTime = now.toLocaleString('id-ID', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            timeZoneName: 'short', timeZone: 'Asia/Jakarta'
        });

        // Instruksi tambahan
        const contextInjection = 
            `*TANGGAL/WAKTU SERVER SAAT INI:* \`${serverTime}\`. ` +
            `*Instruksi Penting*: Gunakan Tool Google Search untuk mendapatkan informasi yang akurat, real-time yang relevan dengan pertanyaan pengguna.`;


        const chat = getOrCreateChat(from);
        const currentModel = chat.model;

        let contents = [...mediaParts];
        let finalQuery;

        // Optimasi Alur: Menggabungkan logika default query
        if (textQuery.length > 0) {
            finalQuery = `${contextInjection}\n\n*Permintaan Pengguna:*\n${textQuery}`;
            contents.push(finalQuery);
        } else if (mediaParts.length > 0) {
             const mediaPart = mediaParts[0];
             const isAudio = mediaPart.inlineData?.mimeType.startsWith('audio');
             const mediaType = isAudio ? 'voice note/audio' : (mediaPart.fileData ? 'video/URL' : (mediaPart.inlineData?.mimeType.startsWith('image') ? 'gambar' : 'dokumen'));
             
             if (isAudio) {
                 finalQuery = `${contextInjection}\n\n*Permintaan Default:*\nTranskripsikan voice note/audio ini ke teks, kemudian balaslah isi pesan tersebut dengan jawaban yang relevan dan personal. Di akhir jawaban Anda, berikan juga transkripsi dan ringkasan VN sebagai referensi.`;
             } else {
                 finalQuery = `${contextInjection}\n\n*Permintaan Default:*\nAnalisis ${mediaType} ini secara sangat mendalam dan detail.`;
             }
             contents.push(finalQuery);
        } else {
             finalQuery = 
                `${contextInjection}\n\n*Permintaan Default:*\nHalo! Saya Gemini. Anda bisa mengajukan pertanyaan, mengirim gambar, video, dokumen (PDF/TXT/DOCX/XLSX/PPTX), atau *voice note* setelah me-*tag* saya. Ketik ${PREFIX}menu untuk melihat daftar perintah.`;
             contents.push(finalQuery);
        }
        
        // Cek apakah contents hanya berisi satu string (kasus non-media), ubah formatnya
        const finalContents = mediaParts.length === 0 && contents.length === 1 ? contents[0] : contents;
        
        console.log(`[GEMINI] Mengirim pesan ke model: ${currentModel}. Media parts: ${mediaParts.length}`);
        
        const response = await chat.sendMessage({ message: finalContents });
        
        console.log(`[GEMINI] Respons diterima.`);

        let geminiResponse = response.text.trim();
        
        // Sorot Timestamp hanya jika ada media video/youtube
        const isYoutubeAnalysis = mediaParts.some(part => part.fileData && part.fileData.mimeType === 'video/youtube');
        
        if (isYoutubeAnalysis) {
             geminiResponse = highlightTimestamps(geminiResponse);
        }
        
        const modelName = currentModel === MODELS.FAST ? 'Fast Mode (gemini-2.5-flash)' : 'Smart Mode (gemini-2.5-pro)';
        const finalResponse =`*💠 Mode Aktif:* \`${modelName}\`\n${geminiResponse}`;

        await sock.sendMessage(from, { text: finalResponse });
        
        // ------------------------------------------------------------------
        // *** OPTIMASI EFISIENSI MEMORI: Hapus Sesi Jika Ada Media ***
        // ------------------------------------------------------------------
        if (hasMedia) {
             // 1. Simpan riwayat percakapan berbasis teks dari sesi lama
             const history = await chat.getHistory();
             
             // 2. Hapus sesi lama (membuang buffer media yang besar dari memori)
             CHAT_SESSIONS.delete(from);
             
             // 3. Buat sesi baru (getOrCreateChat akan membuatnya)
             const newChat = getOrCreateChat(from);
             
             // 4. Hapus entri yang mengandung media (non-string parts)
             const textOnlyHistory = history.filter(msg => {
                 // Filter hanya pesan yang komponen utamanya adalah string (teks)
                 return typeof msg.parts[0] === 'string' || (msg.parts.length === 1 && typeof msg.parts[0].text === 'string');
             });
             
             // Hanya simpan 3 pesan terakhir (teks/jawaban) untuk efisiensi lebih lanjut
             const smallTextHistory = textOnlyHistory.slice(-3);
             
             // Tambahkan riwayat teks kembali ke sesi baru
             newChat.history = smallTextHistory;
             
             console.log(`[OPTIMASI MEMORI] Sesi dengan media dihapus. Sesi baru dibuat dengan ${smallTextHistory.length} riwayat teks.`);
        }
        // ------------------------------------------------------------------

    } catch (error) {
        console.error("-----------------------------------------------------");
        console.error("🚨 GAGAL MEMPROSES PERMINTAAN GEMINI:", error);
        console.error("-----------------------------------------------------");
        
        let errorDetail = "Terjadi kesalahan koneksi atau pemrosesan umum.";
        
        if (error.message.includes('file is not supported') || error.message.includes('Unsupported mime type')) {
            errorDetail = "Tipe file media/audio tidak didukung oleh Gemini API. Pastikan format file audio adalah MP3, WAV, atau format umum lainnya.";
        } else if (error.message.includes('400')) {
             errorDetail = "Ukuran file terlalu besar atau kunci API bermasalah. (Error 400 Bad Request)";
        } else if (error.message.includes('500')) {
             errorDetail = "Gemini API mengalami error internal. Coba lagi sebentar.";
        }

        await sock.sendMessage(from, { text: `Maaf, terjadi kesalahan saat menghubungi Gemini AI.\n\n⚠️ *Detail Error:* ${errorDetail}` });
    } finally {
        await sock.sendPresenceUpdate('available', from); 
    }
}


// --- Fungsi Khusus untuk Image Generation ---
async function handleImageGeneration(sock, from, prompt) {
    try {
        await sock.sendPresenceUpdate('composing', from); 

        const model = MODELS.IMAGE_GEN; 

        console.log(`[GEMINI DRAW] Menerima permintaan: "${prompt}"`);
        
        const response = await ai.models.generateContent({
            model: model,
            contents: [prompt] 
        });

        const imagePart = response.candidates?.[0]?.content?.parts?.find(
            part => part.inlineData && part.inlineData.mimeType.startsWith('image/')
        );
        
        if (imagePart) {
            const imageBuffer = Buffer.from(imagePart.inlineData.data, 'base64');
            
            await sock.sendMessage(from, { 
                image: imageBuffer, 
                caption: `✅ *Gambar Dibuat (Model: \`${model}\`):*\n"${prompt}"`
            });

        } else {
            console.error("[GEMINI DRAW ERROR] Respon tidak mengandung gambar. Respon teks:", response.text);
            await sock.sendMessage(from, { text: `Maaf, gagal membuat gambar untuk prompt: "${prompt}". Model hanya mengembalikan teks:\n${response.text}` });
        }

    } catch (error) {
        console.error("-----------------------------------------------------");
        console.error("🚨 GAGAL MEMPROSES IMAGE GENERATION:", error.message);
        console.error("-----------------------------------------------------");

        await sock.sendMessage(from, { 
            text: "Maaf, terjadi kesalahan saat mencoba membuat gambar dengan Gemini AI. Silakan cek konsol terminal untuk detail error lebih lanjut." 
        });
    } finally {
        await sock.sendPresenceUpdate('available', from); 
    }
}


// --- Fungsi Pengelolaan Perintah ---
async function resetUserMemory(sock, jid) {
    CHAT_SESSIONS.delete(jid);
    await sock.sendMessage(jid, { text: '*✅ Semua ingatan riwayat percakapan Anda telah dihapus*. Ingatan telah dimatikan.' });
}


async function changeModel(sock, jid, modelKey) {
    const newModel = MODELS[modelKey];
    const newModelName = modelKey === 'FAST' ? 'Fast Mode' : 'Smart Mode';
    
    GEMINI_MODEL_MAP.set(jid, newModel);
    CHAT_SESSIONS.delete(jid); 

    await sock.sendMessage(jid, { text: `✅ Mode telah diganti menjadi *${newModelName}* (\`${newModel}\`). Ingatan baru akan dimulai.` });
}


// Fungsi utama untuk menjalankan bot
async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('baileys_auth_info'); 
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false, 
    });

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.generate(qr, { small: true });
            console.log("Scan QR code ini dengan WhatsApp kamu!");
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error) ? 
                (new Boom(lastDisconnect.error)).output.statusCode !== DisconnectReason.loggedOut :
                true; 

            if (shouldReconnect) {
                console.log('Koneksi tertutup, mencoba menyambung ulang secara otomatis...');
                startSock(); 
            } else {
                console.log('Koneksi ditutup. Anda telah logout.');
            }
        } else if (connection === 'open') {
            console.log('Bot siap digunakan! Ingatan Otomatis, Multimodal (Gambar, Video & Dokumen, URL YouTube, Audio), Mode Cerdas, dan Google Search Aktif.');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Event listener untuk pesan masuk
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const m = messages[0];
        if (!m.message || m.key.fromMe) return; 

        const from = m.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        const messageType = Object.keys(m.message)[0];
        let messageText = m.message.conversation || m.message.extendedTextMessage?.text || m.message.imageMessage?.caption || m.message.videoMessage?.caption || m.message.documentMessage?.caption || '';
        
        const command = messageText.toLowerCase().split(' ')[0];
        const args = messageText.slice(command.length).trim();

        // --- LOGIKA PESAN SELAMAT DATANG / SESSION LOCK (Pribadi) ---
        if (!isGroup) {
            const currentStatus = PRIVATE_CHAT_STATUS.get(from);
            const rawText = messageText.trim();
            
            // Logika Sambutan Pertama Kali
            if (!PRIVATE_CHAT_STATUS.has(from) && !CHAT_SESSIONS.has(from) && rawText.length > 0 && !rawText.startsWith(PREFIX)) {
                
                const welcomeMessage = `
Halo anda telah menghubungi fadil silahkan tunggu saya merespon atau.

    Ketik: \`2\`
    untuk memulai percakapan dengan chatbot.
    *jika anda berada di percakapan chatbot*
    Ketik: \`1\`
    (untuk keluar dari percakapan chatbot dan kembali menghubungi nomor ini).

*Petunjuk Singkat:*
- Untuk bertanya/kirim media dengan chatbot, aktifkan sesi dengan mengetik \`2\` terlebih dahulu.
- Ketik \`${PREFIX}menu\` untuk melihat daftar fitur lengkap.
                `.trim();

                await sock.sendMessage(from, { text: welcomeMessage });
                PRIVATE_CHAT_STATUS.set(from, false); 
                return;
            }

            // Logika Session Lock
            if (rawText === '2') {
                PRIVATE_CHAT_STATUS.set(from, true);
                await sock.sendMessage(from, { text: `✅ *Sesi Chatbot Gemini telah diaktifkan!* Anda sekarang bisa langsung bertanya, kirim media, atau URL. Ketik \`1\` untuk keluar dari sesi.` });
                return; 
            }
            if (rawText === '1') {
                PRIVATE_CHAT_STATUS.set(from, false);
                CHAT_SESSIONS.delete(from); 
                await sock.sendMessage(from, { text: `❌ *Sesi Chatbot Gemini telah dinonaktifkan!* Bot akan diam. Ketik \`2\` untuk mengaktifkan sesi lagi.` });
                return;
            }
            // Abaikan jika status non-aktif dan bukan command
            if (currentStatus === false && !messageText.toLowerCase().startsWith(PREFIX)) {
                return;
            }
        }
        
        // --- Penanganan Perintah Khusus (Command Logic) ---
        
        if (command === `${PREFIX}norek`) {
             const imagePath = path.join(__dirname, 'assets', 'norek_info.png'); 
             const caption = '*Berikut adalah informasi rekening dan QR Code untuk transfer.*';
             await handleSendImageCommand(sock, from, imagePath, caption);
             return;
        }
        if (command === `${PREFIX}menu`) {
            await sock.sendMessage(from, { text: setting.GEMINI_MENU });
            return;
        }
        if (command === `${PREFIX}reset`) {
            await resetUserMemory(sock, from);
            return;
        }
        if (command === `${PREFIX}flash` || command === `${PREFIX}fast`) {
            await changeModel(sock, from, 'FAST');
            return;
        }
        if (command === `${PREFIX}pro` || command === `${PREFIX}smart`) {
            await changeModel(sock, from, 'SMART');
            return;
        }
        if (command === `${PREFIX}draw` || command === `${PREFIX}gambar`) {
            if (args.length > 0) {
                await handleImageGeneration(sock, from, args);
            } else {
                await sock.sendMessage(from, { text: "Mohon berikan deskripsi gambar yang ingin Anda buat, contoh: `"+ PREFIX +"draw seekor anjing astronaut di luar angkasa`" });
            }
            return;
        }
        
        // ----------------------------------------------------------------------
        // --- LOGIKA PEMROSESAN QUERY (FINAL) ---
        // ----------------------------------------------------------------------
        
        let queryText = messageText;
        let mediaParts = [];
        let isGeminiQuery = false;
        let documentExtractedText = null; 

        if (isGroup) {
            const isMentioned = isBotMentioned(m, sock);
            if (!isMentioned) return;
            
            // Hapus mention dari query teks
            const botJidRaw = sock.user?.id?.split(':')[0]; 
            if (botJidRaw) {
                queryText = queryText.replace(new RegExp(`@${botJidRaw}`, 'g'), '').trim();
            }
        } 
        
        // Helper untuk download dan pengecekan ukuran media
        const downloadAndCheckSize = async (msg, type) => {
            if (msg.fileLength > MAX_MEDIA_SIZE_BYTES) {
                 await sock.sendMessage(from, { text: `⚠️ Maaf, ukuran file (${type}) melebihi batas maksimum *${(MAX_MEDIA_SIZE_BYTES / 1024 / 1024).toFixed(0)} MB*.` });
                 return null;
            }
            await sock.sendPresenceUpdate('composing', from); 
            const stream = await downloadContentFromMessage(msg, type);
            let buffer = Buffer.from([]);
            for await (const chunk of stream) {
                buffer = Buffer.concat([buffer, chunk]);
            }
            return buffer;
        };
        
        // A1. Pesan Gambar Langsung atau Balasan Gambar
        if (messageType === 'imageMessage' || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
             const imageMsg = messageType === 'imageMessage' ? m.message.imageMessage : m.message.extendedTextMessage.contextInfo.quotedMessage.imageMessage;
             const buffer = await downloadAndCheckSize(imageMsg, 'image');

             if (!buffer) { await sock.sendPresenceUpdate('available', from); return; }
             
             const qrData = await decodeQrCode(buffer);
             if (qrData) {
                 await sock.sendMessage(from, { text: `*✅ QR Code Ditemukan!*:\n\`\`\`\n${qrData}\n\`\`\`` });
                 const qrPrompt = `QR Code di gambar ini berisi data: "${qrData}". Analisis data QR Code ini dan juga gambar keseluruhan, lalu balas pesan ini.`;
                 queryText = queryText.length > 0 ? `${qrPrompt}\n\n*Instruksi Pengguna Tambahan:*\n${queryText}` : qrPrompt;
             }
             
             mediaParts.push(bufferToGenerativePart(buffer, imageMsg.mimetype));
             isGeminiQuery = true;
        }
        
        // A2. Pesan Video Langsung atau Balasan Video
        else if (messageType === 'videoMessage' || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.videoMessage) {
            const videoMsg = messageType === 'videoMessage' ? m.message.videoMessage : m.message.extendedTextMessage.contextInfo.quotedMessage.videoMessage;
            const buffer = await downloadAndCheckSize(videoMsg, 'video');
            
            if (!buffer) { await sock.sendPresenceUpdate('available', from); return; }
            
            console.log(`[VIDEO] Menerima video: ${videoMsg.mimetype}, ukuran: ${buffer.length} bytes`);
            mediaParts.push(bufferToGenerativePart(buffer, videoMsg.mimetype));
            isGeminiQuery = true;
        }
        
        // B. Pemrosesan Dokumen
        else if (messageType === 'documentMessage' || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.documentMessage) {
            const documentMsg = messageType === 'documentMessage' 
                ? m.message.documentMessage 
                : m.message.extendedTextMessage.contextInfo.quotedMessage.documentMessage;

            const mimeType = documentMsg.mimetype;
            
            if (documentMsg.fileLength > MAX_DOC_SIZE_BYTES) {
                await sock.sendMessage(from, { text: `⚠️ Maaf, ukuran dokumen melebihi batas maksimum *${(MAX_DOC_SIZE_BYTES / 1024 / 1024).toFixed(0)} MB*.` });
                await sock.sendPresenceUpdate('available', from);
                return;
            }

            // List mime types yang didukung (diperpendek untuk efisiensi)
            const isSupported = mimeType.includes('pdf') || mimeType.includes('text') || mimeType.includes('json') || mimeType.includes('wordprocessingml') || mimeType.includes('msword') || mimeType.includes('spreadsheetml') || mimeType.includes('presentationml');

            if (isSupported) {
                await sock.sendPresenceUpdate('composing', from); 

                const stream = await downloadContentFromMessage(documentMsg, 'document');
                let buffer = Buffer.from([]);
                for await (const chunk of stream) {
                    buffer = Buffer.concat([buffer, chunk]);
                }
                
                documentExtractedText = await extractTextFromDocument(buffer, mimeType);
                
                if (!documentExtractedText) {
                    mediaParts.push(bufferToGenerativePart(buffer, mimeType));
                    console.log(`[GEMINI API] File ${mimeType} dikirim langsung ke Gemini API.`);
                }
                isGeminiQuery = true;

            } else {
                await sock.sendMessage(from, { text: `⚠️ Maaf, tipe file dokumen \`${mimeType}\` belum didukung. Hanya mendukung *PDF, TXT, DOCX/DOC, XLSX/XLS, PPTX*, dan berbagai tipe file *kode/teks* lainnya.` });
                await sock.sendPresenceUpdate('available', from);
                return;
            }
        }
        
        // C. Deteksi Voice Note/Audio (AKTIF)
        else if (messageType === 'audioMessage' || m.message?.extendedTextMessage?.contextInfo?.quotedMessage?.audioMessage) {
            const audioMsg = messageType === 'audioMessage' 
                ? m.message.audioMessage 
                : m.message.extendedTextMessage.contextInfo.quotedMessage.audioMessage;
            
            if (audioMsg.mimetype.includes('audio')) {
                const buffer = await downloadAndCheckSize(audioMsg, 'audio');
                
                if (!buffer) { await sock.sendPresenceUpdate('available', from); return; }
                
                console.log(`[AUDIO ANALYZER] Menerima Voice Note: ${audioMsg.mimetype}, ukuran: ${buffer.length} bytes`);
                
                mediaParts.push(bufferToGenerativePart(buffer, audioMsg.mimetype));
                isGeminiQuery = true;
                
                // Prompt Interaktif Default untuk Audio (Hanya diterapkan jika query teks kosong)
                if (queryText.length === 0) {
                     queryText = 'Transkripsikan voice note/audio ini ke teks, kemudian balaslah isi pesan tersebut dengan jawaban yang relevan dan personal. Di akhir jawaban Anda, berikan juga transkripsi dan ringkasan VN sebagai referensi.';
                }
            }
        }
        
        // D. Deteksi URL YouTube 
        const youtubeUrl = extractYoutubeUrl(queryText);
        let youtubePart = null;
        
        if (youtubeUrl) {
             youtubePart = uriToGenerativePart(youtubeUrl, 'video/youtube'); 
             mediaParts.push(youtubePart);
             isGeminiQuery = true;
             queryText = queryText.replace(youtubeUrl, '').trim(); 
        }

        // E. Perintah Teks dan Gabungkan Query
        if (documentExtractedText) {
             queryText = `${documentExtractedText}\n\n*Permintaan Analisis Pengguna:*\n${queryText.length > 0 ? queryText : 'Mohon analisis dokumen ini.'}`;
        } else if (youtubePart && queryText.length === 0) {
             queryText = 'Mohon berikan ringkasan yang detail dan analisis mendalam dari video YouTube ini. Sertakan poin-poin penting dan kesimpulan.';
        } else if (mediaParts.length > 0 && queryText.length === 0) {
             const mediaType = mediaParts[0].inlineData?.mimeType.startsWith('image') ? 'gambar' : 'dokumen/file';
             if (mediaType !== 'voice note/audio') {
                 queryText = `Mohon analisis ${mediaType} yang terlampir ini secara mendalam.`;
             }
        }
        
        // --- Eksekusi Gemini ---
        if (isGeminiQuery || queryText.length > 0) {
            await handleGeminiRequest(sock, from, queryText, mediaParts);
            return;
        }
        
        if (messageType !== 'conversation' && messageType !== 'extendedTextMessage') {
             console.log(`[SKIP] Pesan non-teks/non-media yang tidak didukung: ${messageType}`);
             await sock.sendPresenceUpdate('available', from);
        }
    });
}

// Jalankan bot
startSock();
