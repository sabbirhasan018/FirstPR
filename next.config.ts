import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The dev server is reached as both localhost and 127.0.0.1 depending on the
  // browser. Without this, Next blocks its own dev chunks as cross-origin, React
  // never hydrates, and every form silently does nothing. Development only.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};

export default nextConfig;
