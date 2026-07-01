import { setupDevPlatform } from '@opennextjs/cloudflare';

// Enable Cloudflare local dev environment if needed
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your existing config if any
};

export default nextConfig;