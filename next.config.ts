const { setupDevPlatform } = require('@opennextjs/cloudflare');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Your existing config here
};

// Enable Cloudflare local dev environment
if (process.env.NODE_ENV === 'development') {
  setupDevPlatform();
}

module.exports = nextConfig;