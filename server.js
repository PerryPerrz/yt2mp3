const express = require('express');
const cors = require('cors');
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isValidYoutubeUrl(url) {
  if (typeof url !== 'string' || url.length > 200) return false;
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}/;
  return pattern.test(url);
}

function sanitizeUrl(url) {
  if (!/^[a-zA-Z0-9:/?=&._-]+$/.test(url)) {
    throw new Error('URL contient des caractères invalides');
  }
  return url;
}

function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: 30000 }, (error, stdout, stderr) => {
      if (error) reject({ error, stderr, stdout });
      else resolve({ stdout, stderr });
    });
  });
}

// Cookies
const cookiesPath = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);
console.log(hasCookies ? '🍪 Cookies trouvés' : '⚠️ Pas de cookies');

function baseArgs() {
  const args = [
    '--no-check-certificates',
    '--extractor-args', 'youtube:player_client=web',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ];
  if (hasCookies) {
    args.push('--cookies', cookiesPath);
  }
  return args;
}

// ─── Cache des infos vidéo (évite de refaire le call) ───
const infoCache = new Map();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cookies: hasCookies });
});

// ─── INFO : inchangé ───
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ error: 'URL YouTube invalide.' });
    }

    const safeUrl = sanitizeUrl(url);
    console.log('\n📥 [INFO]', safeUrl);

    const args = ['--dump-json', '--no-download', ...baseArgs(), safeUrl];
    const { stdout } = await runYtDlp(args);
    const info = JSON.parse(stdout);

    const result = {
      videoId: info.id,
      title: info.title,
      author: info.uploader || info.channel,
      duration: info.duration,
      thumbnail: info.thumbnail,
      viewCount: String(info.view_count || 0),
    };

    // Mettre en cache le titre
    infoCache.set(safeUrl, result.title);

    res.json(result);
    console.log('✅ [INFO]', info.title);
  } catch (err) {
    console.error('❌ [INFO ERROR]', err.error?.message || err.message);
    res.status(500).json({ error: 'Impossible de récupérer les informations.' });
  }
});

// ─── DOWNLOAD : version STREAMING ───
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ error: 'URL YouTube invalide.' });
    }

    const safeUrl = sanitizeUrl(url);
    console.log('\n📥 [DOWNLOAD STREAM]', safeUrl);

    // Récupérer le titre depuis le cache (évite un 2ème appel)
    const cachedTitle = infoCache.get(safeUrl);
    const safeTitle = cachedTitle
      ? cachedTitle.replace(/[^\w\s-]/gi, '').trim()
      : 'audio';

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Transfer-Encoding', 'chunked');

    // yt-dlp télécharge l'audio et écrit sur stdout
    const ytdlp = spawn('yt-dlp', [
      '-f', 'bestaudio',
      '-o', '-',
      ...baseArgs(),
      safeUrl,
    ]);

    // ffmpeg convertit le stream en MP3 et écrit sur stdout
    const ffmpeg = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-vn',
      '-ab', '192k',
      '-f', 'mp3',
      '-loglevel', 'error',
      'pipe:1',
    ]);

    // Pipeline : yt-dlp stdout → ffmpeg stdin → ffmpeg stdout → response
    ytdlp.stdout.pipe(ffmpeg.stdin);
    ffmpeg.stdout.pipe(res);

    // Logs
    ytdlp.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg && !msg.startsWith('WARNING')) {
        console.log('[YT-DLP]', msg);
      }
    });

    ffmpeg.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.error('[FFMPEG]', msg);
    });

    // Gestion erreurs
    ytdlp.on('error', (err) => {
      console.error('❌ [YT-DLP]', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erreur yt-dlp.' });
      }
    });

    ffmpeg.on('error', (err) => {
      console.error('❌ [FFMPEG]', err.message);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Erreur ffmpeg.' });
      }
    });

    ytdlp.on('close', (code) => {
      if (code !== 0) {
        console.error(`❌ yt-dlp exited with code ${code}`);
        ffmpeg.stdin.end();
      }
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log(`✅ Stream terminé : ${safeTitle}`);
      } else {
        console.error(`❌ ffmpeg exited with code ${code}`);
      }
    });

    // Cleanup si le client coupe
    req.on('close', () => {
      ytdlp.kill();
      ffmpeg.kill();
    });

  } catch (err) {
    console.error('❌ [DOWNLOAD ERROR]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors du téléchargement.' });
    }
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
