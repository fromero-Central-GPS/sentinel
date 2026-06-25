import type { NextConfig } from 'next';
import path from 'path';

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve('.'),
  },
  serverExternalPackages: ['@neondatabase/serverless'],
};

export default nextConfig;
