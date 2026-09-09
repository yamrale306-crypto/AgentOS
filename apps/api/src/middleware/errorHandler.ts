import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError } from '@agentos/database';
import { logger, redact } from '@agentos/config';

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ ok: false, error: { code: err.code, message: err.message } });
    return;
  }
  if (req.header('origin') && err instanceof Error && err.message === 'Origin not allowed by CORS.') {
    logger.warn('cors_rejected', { origin: req.header('origin') ?? 'unknown' });
    res.status(403).json({ ok: false, error: { code: 'FORBIDDEN', message: 'Origin not allowed.' } });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({ ok: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request data.' } });
    return;
  }
  if (err instanceof SyntaxError) {
    res.status(400).json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Malformed request body.' } });
    return;
  }
  const message = err instanceof Error ? err.message : 'Internal server error.';
  logger.error('unhandled_error', { message: redact(message) }, err);
  res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred. Please try again.' } });
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Route not found.' } });
}