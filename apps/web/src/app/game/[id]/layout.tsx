// 动态路由使用 Edge Runtime：Cloudflare Pages (@cloudflare/next-on-pages) 要求所有非静态路由运行在 Edge Runtime，
// 自建部署的 next start / next dev 同样支持。页面本身是客户端组件，此处仅透传 children。
export const runtime = 'edge';

export default function DynamicRouteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
