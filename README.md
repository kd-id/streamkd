<div align="center">

![logo](https://github.com/user-attachments/assets/83d95886-2fbb-45c7-986a-e6c4d053bc55)

## StreamKD: Web-Based Multi-Platform Streaming

[![Version](https://img.shields.io/badge/version-2.2.2-blue.svg)](https://github.com/kd-id/streamkd/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/kd-id/streamkd/blob/main/LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/kd-id/streamkd/blob/main/CONTRIBUTING.md)
[![GitHub Stars](https://img.shields.io/github/stars/kd-id/streamkd?style=social)](https://github.com/kd-id/streamkd/stargazers)
[![GitHub Forks](https://img.shields.io/github/forks/kd-id/streamkd?style=social)](https://github.com/kd-id/streamkd/network/members)

**StreamKD** adalah platform live streaming berbasis web yang powerful dan mudah digunakan. Streaming ke YouTube, Facebook, dan platform RTMP lainnya secara bersamaan dengan satu aplikasi. Dilengkapi dengan video management, scheduled streaming, dan real-time monitoring untuk pengalaman streaming yang profesional.

[🚀 Installation](#-quick-installation) • [📖 Documentation](#-manual-installation) • [🐳 Docker](#-docker-deployment) • [🪛 Troubleshooting](#-troubleshooting) • [💬 Community](https://github.com/kd-id/streamkd/discussions)

![screenshot](https://github.com/user-attachments/assets/fef1c0a5-04f6-41ae-8ea1-5eb1fff13a22)



</div>

---

## ✨ Fitur Utama

- **Multi-Platform Streaming** - Streaming ke berbagai platform populer secara bersamaan
- **Video Gallery** - Kelola koleksi video dengan antarmuka yang intuitif
- **Upload Video** - Upload dari local storage atau import langsung dari Google Drive
- **Scheduled Streaming** - Jadwalkan streaming dengan pengaturan waktu yang fleksibel
- **Advanced Settings** - Kontrol penuh untuk bitrate, resolusi, FPS, dan orientasi video
- **Real-time Monitoring** - Monitor status streaming dengan dashboard real-time
- **Video Analytics** - Pantau statistik dan performa video langsung dari aplikasi
- **Responsive UI** - Antarmuka modern yang responsif di semua perangkat

## 💻 System Requirements

- **Node.js** v18 atau versi terbaru
- **FFmpeg** untuk video processing
- **SQLite3** (sudah termasuk dalam package)
- **VPS/Server** dengan minimal 1 Core CPU & 1GB RAM
- **Port** 7575 (dapat disesuaikan di file [.env](.env))

## ⚡ Quick Installation

Untuk instalasi otomatis, jalankan perintah berikut:

```bash
curl -o install.sh https://raw.githubusercontent.com/kd-id/streamkd/main/install.sh && chmod +x install.sh && ./install.sh
```

## 🔧 Manual Installation

### 1. Persiapan Server

Update sistem operasi:
```bash
sudo apt update && sudo apt upgrade -y
```

Install Node.js:
```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Verifikasi instalasi Node.js:
```bash
node --version
npm --version
```

Install FFmpeg:
```bash
sudo apt install ffmpeg -y
```

Verifikasi instalasi FFmpeg:
```bash
ffmpeg -version
```

Install Git:
```bash
sudo apt install git -y
```

### 2. Setup Project StreamKD

Clone repository:
```bash
git clone https://github.com/kd-id/streamkd
```

Masuk ke direktori project:
```bash
cd streamkd
```

Install Paket Node.JS:
```bash
npm install --ignore-scripts
npm run rebuild-native
```

Generate Secret Key:
```bash
node generate-secret.js
```

Konfigurasi port (opsional):
```bash
nano .env
```

Untuk koneksi YouTube/Google OAuth di VPS, gunakan domain HTTPS, bukan IP publik:
```env
APP_BASE_URL=https://domain-anda.com
```
Redirect URI yang harus ditambahkan di Google Cloud Console:
```text
https://domain-anda.com/auth/youtube/callback
```

Jalankan aplikasi:
```bash
npm run dev
```

### 3. Konfigurasi Firewall

**PENTING: Buka port SSH terlebih dahulu untuk menghindari terputusnya koneksi!**

Buka port SSH (biasanya port 22):
```bash
sudo ufw allow ssh
# atau jika menggunakan port custom SSH
# sudo ufw allow [PORT_SSH_ANDA]
```

Buka port aplikasi (default: 7575):
```bash
sudo ufw allow 7575
```

Verifikasi aturan firewall sebelum mengaktifkan:
```bash
sudo ufw status verbose
```

Aktifkan firewall:
```bash
sudo ufw enable
```

Verifikasi status firewall setelah aktif:
```bash
sudo ufw status
```

### 4. Install Process Manager

Install PM2 untuk mengelola aplikasi:
```bash
sudo npm install -g pm2
```

### 5. Menjalankan Aplikasi

Jalankan aplikasi dengan PM2:
```bash
pm2 start app.js --name streamkd
```

**Setup Auto-Restart saat Server Reboot:**
```bash
# Simpan konfigurasi PM2 saat ini
pm2 save

# Setup PM2 untuk auto-start saat server restart
pm2 startup

# Ikuti instruksi yang muncul, biasanya berupa command yang harus dijalankan dengan sudo
# Contoh output: sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u username --hp /home/username

# Setelah menjalankan command startup, save kembali
pm2 save
```

**Perintah PM2 Berguna:**
```bash
# Lihat status aplikasi
pm2 status

# Restart aplikasi
pm2 restart streamkd

# Stop aplikasi
pm2 stop streamkd

# Lihat logs aplikasi
pm2 logs streamkd

# Monitor resource usage
pm2 monit
```

Akses aplikasi melalui browser:
```
http://IP_SERVER:PORT
```

Contoh: `http://88.12.34.56:7575`

### 6. Cara Update Source Code

Masuk ke folder aplikasi di VPS:
```bash
cd /home/www/streamkd
```

Untuk update pertama setelah fitur fast update tersedia, jalankan:
```bash
git pull origin main
bash scripts/update-vps.sh
```

Untuk update berikutnya, cukup jalankan:
```bash
bash scripts/update-vps.sh
```

Script update cepat akan skip `npm install` jika `package.json` dan `package-lock.json` tidak berubah. Jadi untuk perubahan source code biasa, proses update hanya `git pull` lalu restart aplikasi.

Jika ingin update manual tanpa script:
```bash
git pull origin main
pm2 restart streamkd --update-env
pm2 save
```


## 🔐 Reset Password

Jika lupa password atau perlu reset akun:

```bash
cd streamkd && node reset-password.js
```

## ⏰ Pengaturan Timezone Server

Untuk memastikan scheduled streaming berjalan dengan waktu yang akurat:

### Cek timezone saat ini:
```bash
timedatectl status
```

### Lihat daftar timezone tersedia:
```bash
timedatectl list-timezones | grep Asia
```

### Set timezone ke WIB (Jakarta):
```bash
sudo timedatectl set-timezone Asia/Jakarta
```

### Restart aplikasi setelah mengubah timezone:
```bash
pm2 restart streamkd
```

## 🐳 Docker Deployment

### 1. Persiapan Environment

Buat file `.env` di root project:
```env
PORT=7575
SESSION_SECRET=your_random_secret_here
NODE_ENV=development
APP_BASE_URL=https://domain-anda.com
```

### 2. Build dan Jalankan

```bash
docker-compose up --build
```

Akses aplikasi: [http://localhost:7575](http://localhost:7575)

### 3. Data Persistence

Data akan tersimpan secara otomatis di:
- Database: `db/`
- Logs: `logs/`
- Upload files: `public/uploads/`

### 4. Reset Password (Docker)

```bash
docker-compose exec app node reset-password.js
```

## 🪛 Troubleshooting

### Permission Error
```bash
chmod -R 755 public/uploads/
```

### Port Already in Use
```bash
# Cek proses yang menggunakan port
sudo lsof -i :7575

# Kill proses jika diperlukan
sudo kill -9 <PID>
```

### Database Error
```bash
# Reset database (PERINGATAN: akan menghapus semua data)
rm db/*.db

# Restart aplikasi untuk membuat database baru
pm2 restart streamkd
```

### SQLite GLIBC Error
Jika muncul error seperti `GLIBC_2.38 not found` dari `node_sqlite3.node`, rebuild native module di VPS:
```bash
sudo apt install -y python3 make g++ build-essential
npm run rebuild-native
```

### Docker Troubleshooting

**Tidak bisa login:**
- Pastikan `NODE_ENV=development` untuk akses HTTP
- Periksa permission folder:
  ```bash
  sudo chmod -R 777 db/ logs/ public/uploads/
  ```
- Pastikan `SESSION_SECRET` tidak berubah

**Production (HTTPS):**
- Set `NODE_ENV=production`
- Akses melalui HTTPS untuk cookie session

## 💫 Contributors

[![Contributors](https://contrib.rocks/image?repo=kd-id/streamkd)](https://github.com/kd-id/streamkd/graphs/contributors)

## 📄 License

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/kd-id/streamkd/blob/main/LICENSE)

---
© 2026 - [Bang Tutorial](https://youtube.com/bangtutorial)


