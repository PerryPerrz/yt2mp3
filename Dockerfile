FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Node.js est déjà installé (image node:20)
# On crée un lien pour que yt-dlp le trouve
RUN ln -sf /usr/local/bin/node /usr/bin/nodejs

WORKDIR /app

COPY . .

RUN npm install --production

EXPOSE 3000

CMD ["node", "server.js"]
