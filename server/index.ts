import express from 'express';
import cors from 'cors';
import path from 'path';
import 'dotenv/config';

import { initializeConnections, setupGracefulShutdown } from './database';
import { ingressMiddleware } from './middleware/ingressMiddleware';
import { requestLogger } from './middleware/requestLogger';
import routes from './routes';
import { LOG } from './utils/logger';
import { startDirectBambuIntegration } from './services/directBambu';

const logger = LOG('SERVER');

const app = express();
const port = Number(process.env.PORT) || 3000;

function logStartupEndpoints(listenPort: number): void {
  const p = String(listenPort);
  logger.info('--- SpoolTracker endpoints ---');
  logger.info(`Listening on port ${p} (this process)`);

  logger.info(`API: http://127.0.0.1:${p}/api`);

  logger.info('------------------------------');
}

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    /^https?:\/\/.*\.home-assistant\.io$/,
    /^https?:\/\/.*\.local$/,
    /^https?:\/\/.*\.lan$/
  ],
  credentials: true
}));
app.use(express.json());
app.use('/api', requestLogger);
app.use(ingressMiddleware);

const isProduction = process.env.NODE_ENV === 'production';
if (isProduction) {
  const clientPath = process.env.CLIENT_PATH || path.join(process.cwd(), '../client');
  const staticPath = path.join(clientPath, 'dist');
  logger.info('Serving static files from:', staticPath);
  app.use(express.static(staticPath));
}

app.use(routes);

app.get('{*path}', (_req, res) => {
  const clientPath = process.env.CLIENT_PATH || path.join(process.cwd(), '../client');
  const indexPath = path.join(clientPath, 'dist/index.html');
  res.sendFile(indexPath);
});

async function startServer() {
  await initializeConnections();

  setupGracefulShutdown();

  const server = app.listen(port, () => {
    logStartupEndpoints(port);

    startDirectBambuIntegration().catch((err) =>
      logger.warn('Direct printer integration failed to start:', err)
    );

    logger.info('Startup completed successfully');
  });

  server.on('error', (error) => {
    logger.error('Server error:', error);
    throw error;
  });
}

startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});
