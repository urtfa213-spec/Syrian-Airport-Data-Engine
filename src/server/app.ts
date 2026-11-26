import fs from 'node:fs';
import path from 'node:path';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import { STATIC_DIR } from './config.ts';
import { coreRouter } from './routesCore.ts';
import { archivedFidsRouter } from './routesArchivedFids.ts';
import { historyRouter } from './routesHistory.ts';
import { airTrafficRouter } from './routesAirTraffic.ts';

export function attachApiRoutes(app: Express): void {
  app.use(express.json());

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    next();
  });

  app.use(archivedFidsRouter);
  app.use(historyRouter);
  app.use(airTrafficRouter);
  app.use(coreRouter);

  if (fs.existsSync(STATIC_DIR)) {
    app.use('/static', express.static(STATIC_DIR));
    app.get('/legacy', (_req: Request, res: Response) => {
      res.type('html').send(fs.readFileSync(path.join(STATIC_DIR, 'index.html'), 'utf-8'));
    });
    app.get('/legacy/monitor', (_req: Request, res: Response) => {
      res.type('html').send(fs.readFileSync(path.join(STATIC_DIR, 'air_traffic_monitor.html'), 'utf-8'));
    });
  }
}

export function attachErrorHandler(app: Express): void {
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[Server Error]', err);
    res.status(500).json({ detail: err.message || 'Internal Server Error' });
  });
}

export function createVercelApp(): Express {
  const app = express();
  attachApiRoutes(app);
  attachErrorHandler(app);
  return app;
}
