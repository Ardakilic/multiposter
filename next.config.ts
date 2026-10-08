import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['pg', 'nodemailer'],
  // fixed at build time; matches the MAX_UPLOAD_MB default (runtime can only lower it)
  experimental: { serverActions: { bodySizeLimit: '50mb' } },
  turbopack: {
    rules: {
      '*.css': { loaders: ['@tailwindcss/turbopack'], as: '*.css' },
    },
  },
};

export default nextConfig;
