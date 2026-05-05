import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // Synthetix Matrix Configuration
  const upload = multer({ 
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024 } // 500MB per unit limit as requested
  });

  app.use(express.json({ limit: '1gb' }));
  app.use(express.urlencoded({ limit: '1gb', extended: true }));

  // API: Health Check
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', engine: 'Synthetix_Core_v3.0' });
  });

  // API: Single Unit Synthesis (Optimized for Proxy Stability)
  app.post('/api/synthesize-unit', upload.single('file'), async (req, res) => {
    try {
      const file = req.file;
      const { width, height } = req.body;

      if (!file) {
        return res.status(400).json({ success: false, error: 'Source unit missing' });
      }

      const w = parseInt(width) || 2048;
      const h = parseInt(height) || 2048;

      // High-Throttle Processing Pipeline
      const pipeline = sharp(file.buffer, { failOn: 'none' })
        .rotate()
        .resize(w, h, {
          fit: 'contain',
          background: { r: 255, g: 255, b: 255, alpha: 1 }
        })
        .jpeg({
          quality: 80, // Optimized for speed and size
          chromaSubsampling: '4:2:0', // Faster encoding
          mozjpeg: false, // Standard JPEG is faster to encode than mozjpeg
          force: true
        });

      const buffer = await pipeline.toBuffer();

      res.set('Content-Type', 'image/jpeg');
      return res.send(buffer);
    } catch (error) {
      console.error('[SYNTHETIX] Unit conversion error:', error);
      return res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Internal Synthesis Fault' 
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[SYNTH ENGINE] Running on http://localhost:${PORT}`);
  });
}

startServer();
