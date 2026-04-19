FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Configurer yt-dlp : runtime = node (pas nodejs)
RUN mkdir -p /etc/yt-dlp \
    && echo "--js-runtimes node:/usr/local/bin/node" > /etc/yt-dlp/config

WORKDIR /app

COPY . .

RUN npm install --production

# Vérifier
RUN echo "=== Versions ===" \
    && yt-dlp --version \
    && node --version \
    && ffmpeg -version 2>&1 | head -1

EXPOSE 3000

CMD ["node", "server.js"]
