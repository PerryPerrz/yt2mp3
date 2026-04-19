// backend/server.js
const express = require('express');
const cors = require('cors');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const PORT = 3000;

app.use(cors({ origin: 'http://localhost:4200' }));
app.use(express.json());

// ─── Vérifications au démarrage ───
function checkDependency(cmd, name, versionFlag = '--version') {
  try {
    const { execSync } = require('child_process');
    const output = execSync(`${cmd} ${versionFlag}`, { encoding: 'utf-8' }).trim();
    const firstLine = output.split('\n')[0];
    console.log(`✅ ${name} détecté (${firstLine})`);
  } catch {
    console.error(`❌ ${name} non trouvé !`);
    process.exit(1);
  }
}

checkDependency('yt-dlp', 'yt-dlp', '--version');
checkDependency('ffmpeg', 'ffmpeg', '-version');   // ← -version au lieu de --version

// ─── Validation URL (sécurisée) ───
function isValidYoutubeUrl(url) {
  if (typeof url !== 'string' || url.length > 200) return false;
  const pattern = /^(https?:\/\/)?(www\.)?(youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)[\w-]{11}/;
  return pattern.test(url);
}

// ─── Sanitize URL pour éviter les injections shell ───
function sanitizeUrl(url) {
  // N'autoriser que les caractères valides d'une URL YouTube
  if (!/^[a-zA-Z0-9:/?=&._-]+$/.test(url)) {
    throw new Error('URL contient des caractères invalides');
  }
  return url;
}

// ─── Nettoyage fichier temporaire ───
function cleanupFile(filepath) {
  try {
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log('🗑️  Fichier temporaire supprimé');
    }
  } catch (err) {
    console.error('⚠️  Impossible de supprimer:', filepath);
  }
}

// ─── Promisify exec ───
function execPromise(cmd, options = {}) {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: 60000, ...options }, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

// ─── GET /api/health ───
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// ─── POST /api/info ───
app.post('/api/info', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !isValidYoutubeUrl(url)) {
      return res.status(400).json({ error: 'URL YouTube invalide.' });
    }

    const safeUrl = sanitizeUrl(url);
    console.log('\n📥 [INFO]', safeUrl);

    const { stdout } = await execPromise(
      `yt-dlp --dump-json --no-download "${safeUrl}"`,
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
    console.error('❌ [INFO ERROR]', err.error?.message || err.message);
    res.status(500).json({ error: 'Impossible de récupérer les informations.' });
  }
});

// ─── POST /api/download ───
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

    // Télécharger et convertir en MP3
    await execPromise(
      `yt-dlp -x --audio-format mp3 --audio-quality 192K -o "${tmpFile}.%(ext)s" "${safeUrl}"`,
      { timeout: 120000 }
    );

    // Vérifier que le fichier existe
    if (!fs.existsSync(outputFile)) {
      throw new Error('Fichier MP3 non généré');
    }

    const stats = fs.statSync(outputFile);
    console.log(`✅ MP3 créé: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);

    // Récupérer le titre
    let safeTitle = 'audio';
    try {
      const { stdout } = await execPromise(
        `yt-dlp --get-title "${safeUrl}"`,
        { timeout: 10000 }
      );
      safeTitle = stdout.trim().replace(/[^\w\s-]/gi, '').trim() || 'audio';
    } catch {
      // Garder le titre par défaut
    }

    // Envoyer le fichier
    res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Length', stats.size);

    const fileStream = fs.createReadStream(outputFile);
    fileStream.pipe(res);

    fileStream.on('end', () => {
      console.log(`✅ Envoyé: ${safeTitle}.mp3`);
      cleanupFile(outputFile);
    });

    fileStream.on('error', () => cleanupFile(outputFile));
    req.on('close', () => {
      fileStream.destroy();
      cleanupFile(outputFile);
    });

  } catch (err) {
    console.error('❌ [DOWNLOAD ERROR]', err.error?.message || err.message);
    cleanupFile(outputFile);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Erreur lors de la conversion.' });
    }
  }
});

app.listen(PORT, () => {
  console.log(`
  🚀 Backend YouTube→MP3
  📡 http://localhost:${PORT}
  `);
});
