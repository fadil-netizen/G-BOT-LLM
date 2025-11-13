// setting.js

const { GoogleGenAI } = require('@google/genai');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

// --- KONFIGURASI BOT INTI ---
const PREFIX = '!'; // Awalan perintah bot
// 💡 TEMPAT MENGISI NOMOR: Ganti '6287876611960@s.whatsapp.net' dengan nomor JID Anda
const TARGET_JID = '6287876611960@s.whatsapp.net'; // Nomor tujuan Laporan Status (087876611960)

// --- KONFIGURASI GEMINI ---

// Ambil kunci API dari file .env
const GEMINI_API_KEY = process.env.GEMINI_API_KEY; 

// Inisialisasi GoogleGenAI (Agent Mole)
const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

// Konfigurasi Google Search Tool
const GOOGLE_SEARCH_CONFIG = {
    apiKey: process.env.GOOGLE_SEARCH_API_KEY,
    cx: process.env.GOOGLE_SEARCH_ENGINE_ID,
    // Tambahkan domain pencarian spesifik di sini (opsional)
    // restrict: 'site:kaskus.co.id,site:facebook.com' 
};


// --- PENGELOLAAN MODEL & SESI ---

const MODELS = {
    FAST: 'gemini-2.5-flash',
    SMART: 'gemini-2.5-pro',
    IMAGE_GEN: 'imagen-3.0-generate-002', // Model untuk perintah !draw
    DEFAULT: 'gemini-2.5-flash', // Model default saat sesi dimulai
};

const CHAT_SESSIONS = new Map(); // Untuk menyimpan objek chat Gemini per pengguna (memori)
const GEMINI_MODEL_MAP = new Map(); // Untuk menyimpan preferensi model per pengguna
const PRIVATE_CHAT_STATUS = new Map(); // Untuk mengontrol sesi chatbot di chat pribadi (true/false)

// Instruksi System untuk Smart Mode (Mode Agen Forensik)
const SMART_MODE_SYSTEM_INSTRUCTION = `
Anda adalah **Agent Mole**, sebuah kecerdasan buatan spesialis forensik digital dan intelijen yang dikembangkan oleh FADIL. Tugas Anda adalah membantu penyelidikan kasus kriminal, penipuan, ancaman keamanan, dan informasi gelap di internet.

**Peran dan Gaya Respons:**
1.  **Profesional & Terstruktur:** Berikan jawaban yang mendalam, logis, dan terorganisir seperti laporan intelijen.
2.  **Multimodal:** Menganalisis gambar, video (melalui URL YouTube), dokumen (PDF, DOCX, XLSX, PPTX), dan pesan suara untuk bukti dan konteks.
3.  **Akses Data:**
    * Anda memiliki akses ke **Google Search Tool** untuk fakta, berita, dan informasi publik terkini. **Gunakan tool ini secara agresif** untuk memverifikasi data dan mencari detail insiden.
    * Anda memiliki **akses simulasi ke jaringan Tor/Dark Web**. Jika pengguna mencari \`.onion\` atau topik kriminal/gelap (contoh: *pasar gelap, data bocor, skema penipuan*), lakukan fungsi \`torSearch\` (kode telah disuntikkan). Analisis hasil yang diberikan oleh \`torSearch\` untuk mendapatkan konteks, BUKAN mencoba mengakses tautan tersebut secara langsung.
4.  **Batas Etika & Hukum:** Jangan pernah membantu aktivitas ilegal. Tolak permintaan yang melibatkan:
    * Pencurian data/akun (hacking).
    * Pembuatan materi berbahaya (bom, senjata, racun).
    * Konten dewasa eksplisit.
    * Pelanggaran hak cipta.
    * Informasi pribadi yang sensitif (Doxing) tanpa konteks publik yang jelas.
5.  **Perintah:**
    * \`!reset\` : Hapus ingatan percakapan.
    * \`!pro\` atau \`!smart\` : Ganti ke Model Pro.
    * \`!flash\` atau \`!fast\` : Ganti ke Model Fast.
    * \`!draw [prompt]\` : Buat gambar.
    * \`!norek\` : Kirim informasi rekening.
`;

// Menu Bantuan
const GEMINI_MENU = `
*--- 🕵️ MENU AGENT MOLE 2.5 ---*

Halo! Saya Agent Mole, spesialis forensik digital, siap membantu penyelidikan Anda.

*Mode Aktif Saat Ini:* Menggunakan sistem ingatan.

*🤖 Perintah Chat & Bantuan:*
* \`${PREFIX}menu\` : Menampilkan menu ini.
* \`${PREFIX}reset\` : Menghapus semua riwayat percakapan/ingatan bot dengan Anda. (WAJIB jika bot mulai ngaco).
* \`${PREFIX}norek\` : Mengirimkan gambar informasi rekening untuk transaksi.

*⚙️ Pengaturan Model (Ganti Kecerdasan):*
* \`${PREFIX}fast\` / \`${PREFIX}flash\` : Menggunakan *Gemini 2.5 Flash* (Respon cepat, efisien, ideal untuk pertanyaan umum/ringan).
* \`${PREFIX}smart\` / \`${PREFIX}pro\` : Menggunakan *Gemini 2.5 Pro* (Analisis mendalam, penalaran kompleks, cocok untuk investigasi).

*🖼️ Pembuatan Gambar (AI Image Generation):*
* \`${PREFIX}draw [deskripsi]\` : Membuat gambar berdasarkan deskripsi yang Anda berikan. Contoh: \`${PREFIX}draw seekor anjing detektif mengenakan topi fedora, gaya noir.\`

*Tips Investigasi:*
1.  Untuk hasil maksimal, aktifkan mode \`${PREFIX}smart\` sebelum memulai analisis kasus yang kompleks.
2.  Bot secara otomatis menggunakan *Google Search* untuk mencari info terkini, *Dark Web Search (Tor)* untuk tautan \`.onion\`, dan menganalisis *Gambar, Video (YouTube), Dokumen* (PDF, DOCX, XLSX, PPTX), dan *Pesan Suara*.
3.  Di chat pribadi, pastikan sesi aktif (\`2\` telah diketik) agar bot merespons tanpa perlu di-tag.
`;

// Eksport semua konstanta yang dibutuhkan oleh index.js
module.exports = {
    MOLE_AI_INSTANCE: ai,
    PREFIX,
    CHAT_SESSIONS,
    GEMINI_MODEL_MAP,
    MODELS,
    SMART_MODE_SYSTEM_INSTRUCTION,
    GOOGLE_SEARCH_CONFIG,
    TARGET_JID,
    GEMINI_MENU,
    PRIVATE_CHAT_STATUS
};