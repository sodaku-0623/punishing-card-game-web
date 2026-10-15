import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/auth-context';

export const metadata: Metadata = {
  title: '战双帕弥什 卡牌对战 | 在线多人对战平台',
  description: '《战双帕弥什 卡牌对战》官方规则驱动的在线竞技平台',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased selection:bg-terminalCyan/20 selection:text-terminalCyan">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}

