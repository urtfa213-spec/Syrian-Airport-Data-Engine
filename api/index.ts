import type { IncomingMessage, ServerResponse } from 'node:http';
import { createVercelApp } from '../src/server/app.ts';

const app = createVercelApp();

export default function handler(
  req: IncomingMessage & { url?: string },
  res: ServerResponse
) {
  if (req.url) {
    try {
      const parsed = new URL(req.url, 'http://localhost');
      const vpath = parsed.searchParams.get('__vpath');
      if (vpath !== null) {
        parsed.searchParams.delete('__vpath');
        const qs = parsed.searchParams.toString();
        req.url = `/api/${vpath.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`;
      } else if (
        parsed.pathname === '/api' ||
        parsed.pathname === '/api/index' ||
        parsed.pathname === '/api/index.ts'
      ) {
        req.url = '/api/airports';
      }
    } catch {
      // Preserve original URL if malformed
    }
  }

  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
