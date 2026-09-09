import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import env, { parseOrigins } from '@agentos/config';
import { logger } from '@agentos/config';
import { tasksRouter } from './routes/tasks.js';
import { healthRouter } from './routes/health.js';
import { systemRouter } from './routes/system.js';
import { appVersionRouter } from './routes/appVersion.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { randomUUID } from 'node:crypto';

const origins = parseOrigins(env.FRONTEND_ORIGIN);

const requestLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  skip: (req) => req.method === 'POST' && req.path === '/api/tasks',
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } }
});

const taskCreationLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.method !== 'POST' || req.path !== '/api/tasks',
  message: { ok: false, error: { code: 'RATE_LIMITED', message: 'You are creating tasks too quickly. Slow down and try again.' } }
});

export function createApp(): Express {
  const app = express();
  app.disable('x-powered-by');

  // Render (and most hosted environments) terminate TLS and forward requests;
  // without this, per-IP rate limits would bucket every user behind the proxy's IP.
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || origins.includes(origin)) return callback(null, true);
        return callback(new Error('Origin not allowed by CORS.'));
      },
      methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type'],
      credentials: false
    })
  );

  app.use(express.json({ limit: '256kb' }));
  app.use(requestLimiter);
  app.use(taskCreationLimiter);

  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = req.header('x-request-id')?.slice(0, 128) || randomUUID();
    const started = performance.now();
    res.setHeader('x-request-id', requestId);
    res.on('finish', () => logger.info('http_request', {
      request_id: requestId, method: req.method, route: req.route?.path ?? req.path,
      status: res.statusCode, latency_ms: Math.round(performance.now() - started), user_id: req.user?.id
    }));
    next();
  });

  app.use(healthRouter);
  app.use(appVersionRouter);
  app.use(tasksRouter);
  app.use(systemRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}