// server.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ─── Servir le frontend Angular ───
app.use(express.static(path.join(__dirname, 'public')));

// ─── Validation URL ───
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

function execPromise(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 60000, ...options }, (error, stdout, stderr) => {
      if (error) reject({ error, stderr });
      else resolve({ stdout, stderr });
    });
  });
}

// ─── API ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ error: 'URL YouTube invalide.' });
    }

    const safeUrl = sanitizeUrl(url);
    console.log('\n📥 [INFO]', safeUrl);

    const { stdout } = await execPromise(
      `yt-dlp --dump-json --no-download --no-check-certificates "${safeUrl}"`,
      { timeout: 30000 }
    );

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
    // Log l'erreur COMPLÈTE
    console.error('❌ [INFO ERROR]', err.error?.message || err.message);
    console.error('❌ [INFO STDERR]', err.stderr || 'no stderr');
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

    await execPromise(
      `yt-dlp -x --audio-format mp3 --audio-quality 192K --no-check-certificates -o "${tmpFile}.%(ext)s" "${safeUrl}"`,
      { timeout: 120000 }
    );

    if (!fs.existsSync(outputFile)) throw new Error('MP3 non généré');

    const stats = fs.statSync(outputFile);
    console.log(`✅ MP3: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    let safeTitle = 'audio';
    try {
      const { stdout } = await execPromise(`yt-dlp --get-title --no-check-certificates "${safeUrl}"`, { timeout: 10000 });
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
    console.error('❌ [DOWNLOAD STDERR]', err.stderr || 'no stderr');
    cleanupFile(outputFile);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la conversion.' });
    }
  }
});

// ─── Toutes les autres routes → Angular ───
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
