// setting.js

require('dotenv').config(); 
const { GoogleGenAI } = require('@google/genai');

// Kunci API diambil dari file .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GOOGLE_SEARCH_API_KEY = process.env.GOOGLE_SEARCH_API_KEY; 
const GOOGLE_SEARCH_ENGINE_ID = process.env.GOOGLE_SEARCH_ENGINE_ID; 

if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY tidak ditemukan di file .env. Mohon isi kunci API Anda.");
}

const ai = new GoogleGenAI(GEMINI_API_KEY);

const chatSessions = new Map();
const modelMap = new Map();
const privateChatStatus = new Map(); // Map untuk status sesi chat pribadi

const MODELS = {
    FAST: 'gemini-2.5-flash', 
    SMART: 'gemini-2.5-pro',  
    IMAGE_GEN: 'gemini-2.5-flash-image', 
    DEFAULT: 'gemini-2.5-flash'
};

// Instruksi System Khusus untuk Smart Mode (Analisis Mendalam)
const SMART_MODE_SYSTEM_INSTRUCTION = (
    "Anda adalah asisten AI dengan kecerdasan visual dan penalaran dokumen yang SANGAT TINGGI (Smart Mode). " +
    "Tujuan Anda adalah memberikan analisis yang sangat detail, panjang, terstruktur, dan komprehensif. " +
    "Jika respons Anda mengandung:\n" +
    "1. Kode program, perintah terminal, atau data tabular (tabel).\n" +
    "2. *Rumus Matematika* (misalnya: persamaan aljabar, kalkulus, statistik).\n" +
    "3. *Rumus Kimia* (misalnya: persamaan reaksi, struktur sederhana, notasi teknis).\n" +
    "4. Teks teknis lainnya yang melibatkan simbol, subskrip, atau superskrip.\n" +
    "\n" +
    "Anda *SELALU* harus menyertakannya dalam *Code Block* (menggunakan 3 backtick ``` ) agar teks tersebut rapi, mudah disalin, dan tidak rusak oleh pemformatan chat. " +
    "Di dalam Code Block, gunakan notasi yang paling jelas: *boleh menggunakan simbol Unicode* seperti subskrip (misalnya: *H₂O* atau *C₆H₁₂O₆*) atau superskrip (misalnya: *x²* atau *e⁺*), tetapi *hindari sintaks LaTeX formal* (seperti $...$) yang tidak dapat ditampilkan di WhatsApp.\n" +
    "Untuk analisis gambar, ikuti format ini secara ketat:\n" +
    "*1. Observasi Visual Detail*\n" +
    "   - Buat minimal 5 poin observasi terperinci tentang elemen, warna, komposisi, dan subjek dalam gambar.\n" +
    "\n" +
    "*2. Inferensi dan Analisis Mendalam*\n" +
    "   - Jelaskan makna, konteks, fungsi, atau tujuan dari gambar tersebut. Gunakan penalaran yang kuat.\n" +
    "\n" +
    "*3. Kesimpulan Komprehensif*\n" +
    "   - Berikan ringkasan yang jelas dan tuntas.\n" +
    "Semua output Anda harus menggunakan pemformatan *bold* untuk subjudul dan *daftar poin* untuk kejelasan, JANGAN gunakan simbol pagar (#, ##, ###) di awal baris."
).trim();


const setting = {
    GEMINI_API_KEY: GEMINI_API_KEY,
    GEMINI_AI_INSTANCE: ai,
    SMART_MODE_SYSTEM_INSTRUCTION: SMART_MODE_SYSTEM_INSTRUCTION, 
    
    CHAT_SESSIONS: chatSessions,
    GEMINI_MODEL_MAP: modelMap,
    MODELS: MODELS,
    PRIVATE_CHAT_STATUS: privateChatStatus, 
    
    PREFIX: '/', 

    GOOGLE_SEARCH_CONFIG: {
        apiKey: GOOGLE_SEARCH_API_KEY, 
        cx: GOOGLE_SEARCH_ENGINE_ID, 
    },

    GEMINI_MENU: `
*Menu Bot Gemini AI*

Fitur ini ditenagai oleh Google Gemini.
---

*Fitur Utama*
- 💬 *Ingatan Otomatis*: Bot mengingat konteks percakapan Anda (kecuali direset).
- 🎙️ *Analisis Voice Note*: Kirim *Voice Note/Audio* untuk ditranskripsikan, direspons, dan dianalisis.
- 🖼️ *Multimodal*: Bot bisa menganalisis gambar, *dokumen (PDF, DOCX, XLSX, PPTX, dll)*.
- 📺 *Analisis YouTube*: Kirim *URL YouTube* untuk ringkasan dan analisis video tanpa batas ukuran file.
- 📹 *Unggah Video*: Unggah file *video* langsung (maks. 250 MB).
- 💻 *Dukungan Kode/File Teks*: Mampu menganalisis file kode (*.js, .py, .html*) dan file teks kustom (*.mcx-5, .log, dll.*) hingga *100 MB*.
- 🌐 *Real-time Info*: Bot dapat mencari informasi terbaru menggunakan Google Search Tool.

*⚙️ Pengaturan Mode Kecerdasan*
Model default saat ini: \`gemini-2.5-flash\`

1. *Fast Mode* (Cepat)
   - Perintah: \`/flash\` atau \`/fast\`
   - Model: \`gemini-2.5-flash\`
   > Cocok untuk jawaban cepat, ringkasan, dan obrolan biasa.

2. *Smart Mode* (Cerdas)
   - Perintah: \`/pro\` atau \`/smart\`
   - Model: \`gemini-2.5-pro\`
   > Cocok untuk penalaran mendalam, analisis gambar detail, dan tugas yang butuh kecermatan tinggi. Output lebih panjang dan jelas, *terutama untuk rumus dan kode*.

*🎨 Pembuatan Gambar (Text-to-Image)*
- Perintah: \`/draw [prompt]\` atau \`/gambar [prompt]\`
    > Contoh: \`/draw seekor anjing astronaut di luar angkasa\`

*🧹 Perintah Khusus*
- \`/reset\` : Hapus semua ingatan riwayat percakapan Anda saat ini.
- \`/menu\` : Tampilkan menu ini.
- \`/norek\` : Tampilkan informasi rekening.
- *Chat Pribadi*: Ketik \`2\` untuk mengaktifkan bot, dan \`1\` untuk mematikan bot.
    `.trim()
};

module.exports = setting;
