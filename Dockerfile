# Gunakan base image Node.js versi 20 dengan Debian Bookworm
FROM node:20-bookworm

# Install dependency sistem yang dibutuhkan (ffmpeg untuk video, build tools untuk native module seperti sqlite3)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Set working directory di dalam container
WORKDIR /app

# Copy package metadata dan script postinstall native module
COPY package*.json ./
COPY scripts/rebuild-native.js ./scripts/rebuild-native.js

# Install dependency production. Di Linux, postinstall akan rebuild sqlite3 dari source
# agar native binding cocok dengan versi GLIBC server/container.
RUN npm install --omit=dev

# Copy seluruh source code
COPY . .

# Buat folder yang dibutuhkan (jika belum ada)
RUN mkdir -p db logs public/uploads/videos public/uploads/thumbnails

# Expose port (default 7575, bisa diubah via .env)
EXPOSE 7575

# Jalankan aplikasi
CMD ["npm", "start"]
