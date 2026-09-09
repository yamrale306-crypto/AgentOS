import { Router } from 'express';
import env from '@agentos/config';

/** Public, non-sensitive update metadata. Packages still verify their own signatures. */
export const appVersionRouter: Router = Router();

appVersionRouter.get('/api/app/version', (_req, res) => {
  res.json({
    ok: true,
    data: {
      version: env.APP_VERSION,
      desktop: { latestVersion: env.DESKTOP_LATEST_VERSION ?? env.APP_VERSION, downloadUrl: env.DESKTOP_DOWNLOAD_URL ?? null, mandatory: false },
      android: { latestVersion: env.ANDROID_LATEST_VERSION ?? env.APP_VERSION, downloadUrl: env.ANDROID_DOWNLOAD_URL ?? null, mandatory: false }
    }
  });
});