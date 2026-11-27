# 💸 Dompet Kita AI — Pencatat Pengeluaran Pasutri

Asisten pencatat pengeluaran rumah tangga berbasis AI yang memungkinkan Suami dan Istri mencatat transaksi cukup dengan **mengetik kalimat bebas atau menggunakan suara**, lalu otomatis tersusun rapi ke dalam **Google Sheets**.

Dirancang **100% gratis tanpa database tambahan** menggunakan kombinasi **GitHub Pages** (antarmuka web) dan **Google Apps Script** (backend & integrasi Gemini AI).

---

## ✨ Fitur Utama

* **🎙️ Input Suara & Teks Natural:** Cukup ucapkan atau ketik pengeluaran sehari-hari (misal: *"nasi kuning 8000, kukusan 8000"* atau *"kemarin foya-foya beli kopi 35rb"*).
* **🏷️ Identitas Pencatat Otomatis (`s` / `i`):** Setiap catatan otomatis diberi kode pelaku (**`s`** untuk Suami, **`i`** untuk Istri) berdasarkan profil yang dipilih di HP masing-masing.
* **📂 Pemilahan 3 Kategori Tabel:**
  * **Pengeluaran Bulanan** *(Default)*: Makan, jajanan harian, laundry, belanja dapur, bensin, dll.
  * **Foya-foya Bulanan**: Masuk ke tabel ini jika menyebut kata kunci `"foya-foya"`.
  * **Sampingan Bulanan**: Masuk ke tabel ini jika menyebut kata kunci `"sampingan"`.
* **🧮 Format Deskripsi & Rumus Otomatis:**
  * Kolom deskripsi mencatat detail item beserta harga singkat & kode pelaku (contoh: `nasi kuning 8rb s, kukusan 8rb s`).
  * Kolom total harian otomatis menulis rumus penjumlahan berurutan (contoh: `=8000+8000`).
* **📅 Siklus *Cut-Off* Tanggal 25:** Pengeluaran mulai **tanggal 26** otomatis diarahkan ke tab bulan berikutnya (misal transaksi `26 Nov` otomatis masuk ke tab `Dec 26`).
* **🔒 Anti-Nimpa (`LockService`):** Aman digunakan oleh Suami dan Istri di detik yang sama tanpa saling menimpa data.
* **🔄 *Auto-Fallback* Model Gemini:** Otomatis beralih antar model Gemini (`gemini-3.6-flash`, `gemini-3.8-flash`, `gemini-4-hydrogen`, `gemini-3.5-flash-lite`) jika salah satu server sedang sibuk.

---

## 🛡️ Arsitektur Keamanan

Meskipun repository ini bersifat **Public** di GitHub Pages, data keuangan dan API Key Anda tetap aman karena:
1. **Tidak ada kredensial di kode sumber:** `GEMINI_API_KEY` dan `APP_PIN` disimpan di **Script Properties** milik Google Apps Script, bukan di `index.html`.
2. **Autentikasi PIN:** Setiap permintaan ke Google Sheet wajib menyertakan PIN rahasia bersama.
3. **Penyimpanan Lokal Perangkat:** URL Web App, PIN, dan pilihan profil (`s`/`i`) hanya disimpan di `localStorage` browser masing-masing HP.

---

## 🚀 Cara Pemasangan (Setup)

### 1. Konfigurasi Backend (Google Apps Script)
1. Buka file **Google Sheet** pencatatan pengeluaran Anda.
2. Klik menu **Extensions → Apps Script**.
3. Hapus kode bawaan, lalu tempel seluruh isi file **`Code.gs`** dan simpan (`Ctrl + S`).
4. Buka **Project Settings (ikon gerigi)** → bagian **Script Properties** → tambahkan dua properti berikut:
   * `GEMINI_API_KEY`: API Key gratis dari [Google AI Studio](https://google.com).
   * `APP_PIN`: PIN rahasia bersama (misal: `123456`).
5. Klik **Deploy → New deployment → Web app**:
   * **Execute as:** `Me`
   * **Who has access:** `Anyone`
6. Klik **Deploy**, berikan izin akses, lalu salin **Web App URL** (`/exec`).

### 2. Hosting Frontend (GitHub Pages)
1. Unggah file **`index.html`** ke repository GitHub ini.
2. Masuk ke **Settings → Pages**.
3. Pada bagian **Branch**, pilih **`main`** dan folder **`/ (root)`**, lalu klik **Save**.
4. Tunggu 1–2 menit hingga alamat web `https://<username>.github.io/<nama-repo>/` aktif.

### 3. Pengaturan di HP Suami & Istri
1. Buka link GitHub Pages di browser HP (Chrome / Safari).
2. Ketuk tombol **⚙️ Pengaturan**, masukkan **Web App URL** dan **PIN**, lalu tekan **Simpan** dan **🔌 Tes Koneksi**.
3. Pilih profil **Suami (kode: s)** di HP Suami, dan **Istri (kode: i)** di HP Istri.
4. *(Opsional)* Gunakan fitur **Add to Home Screen / Tambahkan ke Layar Utama** pada browser agar dapat dibuka layaknya aplikasi.

---

## 💡 Contoh Penggunaan

| Input (Ketik / Suara) | Tab Tujuan | Tabel Kategori | Hasil di Google Sheet |
| :--- | :--- | :--- | :--- |
| *"Nasi kuning 8000, kukusan 8000"* | `Dec 26` *(jika tgl 26 Nov–25 Des)* | Pengeluaran Bulanan | Deskripsi: `nasi kuning 8rb s, kukusan 8rb s`<br>Total: `=8000+8000` |
| *"Kemarin istri foya-foya beli sbux 60rb"* | Sesuai tanggal kemarin | Foya-foya Bulanan | Deskripsi: `sbux 60rb i`<br>Total: `=60000` |
| *"Sampingan token listrik 200rb"* | Tab siklus aktif | Sampingan Bulanan | Deskripsi: `token listrik 200rb s`<br>Total: `=200000` |
