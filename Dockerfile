# Gunakan Node.js versi terbaru
FROM node:20-slim

# Install library pendukung untuk Baileys & Puppeteer (biar stabil)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy package.json dan install dependencies
COPY package*.json ./
RUN npm install

# Copy semua file project
COPY . .

# Port standar Hugging Face
EXPOSE 7860

# Jalankan bot
CMD ["npm", "start"]
