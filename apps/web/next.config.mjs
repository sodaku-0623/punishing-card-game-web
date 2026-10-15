// /api/* 反向代理目标：本地默认 4000 端口，容器部署时通过 API_PROXY_TARGET 指向后端服务
const apiProxyTarget = (process.env.API_PROXY_TARGET || 'http://127.0.0.1:4000').replace(/\/$/, '');

const isStaticExport = process.env.OUTPUT_EXPORT === 'true' || process.env.CF_PAGES === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: isStaticExport ? 'export' : 'standalone',
  transpilePackages: ['@zhanshuang/shared', '@zhanshuang/game-rules'],
  compress: true,
  images: {
    unoptimized: true,
  },
  ...(isStaticExport
    ? {}
    : {
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
              destination: `${apiProxyTarget}/api/:path*`,
            },
          ];
        },
      }),
};

export default nextConfig;
