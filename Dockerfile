FROM node:20-slim

RUN apt-get update && apt-get install -y \
    python3 \
    ffmpeg \
    curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copier TOUT le projet
COPY . .

# Installer les dépendances
RUN npm install --production

# Vérifier que public/ existe (debug)
RUN echo "=== Contenu de /app ===" && ls -la /app
RUN echo "=== Contenu de /app/public ===" && ls -la /app/public

EXPOSE 3000

CMD ["node", "server.js"]
