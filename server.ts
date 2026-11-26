import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import express, { type Request, type Response } from 'express';
import { BASE_DIR } from './src/server/config.ts';
import { attachApiRoutes, attachErrorHandler } from './src/server/app.ts';

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const HOST = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

attachApiRoutes(app);

if (!isProd) {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'spa',
    root: BASE_DIR,
  });
  app.use(vite.middlewares);
} else {
  const distDir = path.join(BASE_DIR, 'dist');
  if (fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }
}

attachErrorHandler(app);

app.listen(PORT, HOST, () => {
  console.log(`Syrian Airport Data Engine listening on http://${HOST}:${PORT}`);
});
