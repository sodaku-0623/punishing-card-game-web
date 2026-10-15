/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  transpilePackages: ['@zhanshuang/shared', '@zhanshuang/game-rules'],
  compress: true,
  async headers() {
    return [
      {
        // 为卡牌图片与高清缩略图提供强缓存 (1年)，避免重复网络传输
        source: '/cards/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://127.0.0.1:4000/api/:path*',
      },
    ];
  },
};

export default nextConfig;
