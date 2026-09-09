import type { NextConfig } from 'next';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: process.env.AGENTOS_STATIC_EXPORT === 'true' ? 'export' : 'standalone',
  // Do not let a parent lockfile expand tracing outside this deployable app.
  outputFileTracingRoot: projectRoot
};

export default nextConfig;
