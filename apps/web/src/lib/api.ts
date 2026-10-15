/**
 * 统一 API 客户端辅助工具
 * 自动适配本地开发、局域网访问、外网穿透 (cpolar/frp/ngrok) 与云端反向代理环境
 */

export function getApiBaseUrl(): string {
  // 1. 若构建或运行时显式指定了服务端地址，则优先使用
  if (process.env.NEXT_PUBLIC_SERVER_URL) {
    return process.env.NEXT_PUBLIC_SERVER_URL.replace(/\/$/, '');
  }

  // 2. 浏览器端：返回空字符串即相对路径，由浏览器自动根据当前访问的 Host、Port 和 Protocol (HTTP/HTTPS) 发起请求
  //    这使得外网穿透与局域网多端访问无需任何手动配置即可完美工作！
  if (typeof window !== 'undefined') {
    return '';
  }

  // 3. 服务端渲染 (SSR) 阶段：回退至本机后端服务端口
  return 'http://127.0.0.1:4000';
}

/**
 * 格式化 API 请求完整路径
 * @param path 以 / 开头的 API 路径，如 '/api/auth/login'
 */
export function apiUrl(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const base = getApiBaseUrl();
  return base ? `${base}${normalized}` : normalized;
}
