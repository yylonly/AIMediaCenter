/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'image.tmdb.org' },
      { protocol: 'https', hostname: '**' }
    ]
  },
  // 允许 Node 内建模块用于 API route
  serverExternalPackages: ['@ctrl/qbittorrent', 'parse-torrent', 'nunjucks']
};

module.exports = nextConfig;
