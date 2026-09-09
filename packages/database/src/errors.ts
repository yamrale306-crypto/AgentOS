export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(message: string): AppError {
  return new AppError(400, 'BAD_REQUEST', message);
}

export function unauthorized(message = 'Authentication required.'): AppError {
  return new AppError(401, 'UNAUTHORIZED', message);
}

export function forbidden(message: string): AppError {
  return new AppError(403, 'FORBIDDEN', message);
}

export function notFound(message = 'Resource not found.'): AppError {
  return new AppError(404, 'NOT_FOUND', message);
}

export function conflict(message: string): AppError {
  return new AppError(409, 'CONFLICT', message);
}

export function quotaExceeded(message: string): AppError {
  return new AppError(429, 'QUOTA_EXCEEDED', message);
}

export function tooManyRequests(message = 'Too many requests. Please try again later.'): AppError {
  return new AppError(429, 'RATE_LIMITED', message);
}