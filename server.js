// server.js
const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

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

function cleanupFile(filepath) {
  try {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
  } catch {}
}

// Utiliser execFile au lieu de exec (pas de shell = pas de problème de guillemets)
function runYtDlp(args) {
  return new Promise((resolve, reject) => {
    execFile('yt-dlp', args, { timeout: 120000 }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr, stdout });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// Cookies
const cookiesPath = path.join(__dirname, 'cookies.txt');
const hasCookies = fs.existsSync(cookiesPath);
console.log(hasCookies ? '🍪 Cookies trouvés' : '⚠️ Pas de cookies');

// Args de base pour yt-dlp
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

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', cookies: hasCookies });
});

app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ error: 'URL YouTube invalide.' });
    }

    const safeUrl = sanitizeUrl(url);
    console.log('\n📥 [INFO]', safeUrl);

    const args = ['--dump-json', '--no-download', ...baseArgs(), safeUrl];
    console.log('🔄 ARGS:', args.join(' '));

    const { stdout } = await runYtDlp(args);

    const info = JSON.parse(stdout);
    res.json({
      videoId: info.id,
      title: info.title,
      author: info.uploader || info.channel,
      duration: info.duration,
      thumbnail: info.thumbnail,
      viewCount: String(info.view_count || 0),
    });
    console.log('✅ [INFO]', info.title);
  } catch (err) {
    console.error('❌ [INFO ERROR]', err.error?.message || err.message);
    console.error('❌ [STDERR]', err.stderr || 'empty');
    console.error('❌ [STDOUT]', err.stdout || 'empty');
    res.status(500).json({ error: 'Impossible de récupérer les informations.' });
  }
});

app.post('/api/download', async (req, res) => {
  const tmpFile = path.join(os.tmpdir(), `yt-mp3-${Date.now()}`);
  const outputFile = `${tmpFile}.mp3`;

  try {
    const { url } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ error: 'URL YouTube invalide.' });
    }

    const safeUrl = sanitizeUrl(url);
    console.log('\n📥 [DOWNLOAD]', safeUrl);

    const dlArgs = [
      '-x', '--audio-format', 'mp3',
      '--audio-quality', '192K',
      ...baseArgs(),
      '-o', `${tmpFile}.%(ext)s`,
      safeUrl,
    ];

    await runYtDlp(dlArgs);

    if (!fs.existsSync(outputFile)) throw new Error('MP3 non généré');

    const stats = fs.statSync(outputFile);
    console.log(`✅ MP3: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    let safeTitle = 'audio';
    try {
      const { stdout } = await runYtDlp(['--get-title', ...baseArgs(), safeUrl]);
      safeTitle = stdout.trim().replace(/[^\w\s-]/gi, '').trim() || 'audio';
    } catch {}

    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stats.size);

    const fileStream = fs.createReadStream(outputFile);
    fileStream.pipe(res);
    fileStream.on('end', () => cleanupFile(outputFile));
    fileStream.on('error', () => cleanupFile(outputFile));
    req.on('close', () => { fileStream.destroy(); cleanupFile(outputFile); });

  } catch (err) {
    console.error('❌ [DOWNLOAD ERROR]', err.error?.message || err.message);
    console.error('❌ [STDERR]', err.stderr || 'empty');
    cleanupFile(outputFile);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la conversion.' });
    }
  }
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
