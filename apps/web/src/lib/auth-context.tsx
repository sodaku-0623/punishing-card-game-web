'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { resetSocket } from './socket';
import { apiUrl } from './api';

export interface User {
  id: string;
  username: string;
  nickname: string;
  role: 'USER' | 'ADMIN';
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAdmin: boolean;
  isLoggedIn: boolean;
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, password: string, nickname?: string) => Promise<{ success: boolean; error?: string }>;
  updateNickname: (nickname: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => void;
  authFetch: (url: string, options?: RequestInit) => Promise<Response>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const TOKEN_KEY = 'zhanshuang_auth_token';
const USER_KEY = 'zhanshuang_auth_user';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // 初始化从 localStorage 读取凭据并静默验证有效性
  useEffect(() => {
    try {
      const storedToken = localStorage.getItem(TOKEN_KEY);
      const storedUser = localStorage.getItem(USER_KEY);
      if (storedToken && storedUser) {
        const parsedUser = JSON.parse(storedUser);
        setToken(storedToken);
        setUser(parsedUser);

        // 后台静默校验 token 是否仍然有效
        fetch(apiUrl('/api/auth/me'), {
          headers: { Authorization: `Bearer ${storedToken}` },
        })
          .then(async (res) => {
            if (res.ok) {
              const data = await res.json();
              if (data.user) {
                setUser(data.user);
                localStorage.setItem(USER_KEY, JSON.stringify(data.user));
              }
            } else if (res.status === 401) {
              // Token 失效
              logout();
            }
          })
          .catch(() => {
            // 网络离线时保留缓存凭证
          });
      }
    } catch (e) {
      console.error('Failed to load auth state from localStorage:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const login = async (username: string, password: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || '登录失败，请检查账号密码' };
      }

      const receivedToken = data.token || data.data?.token;
      const receivedUser = data.user || data.data?.user;

      setToken(receivedToken);
      setUser(receivedUser);
      localStorage.setItem(TOKEN_KEY, receivedToken);
      localStorage.setItem(USER_KEY, JSON.stringify(receivedUser));
      resetSocket();

      return { success: true };
    } catch (err: any) {
      return { success: false, error: '无法连接到认证服务器，请确认服务端已启动且网络通畅' };
    }
  };

  const register = async (username: string, password: string, nickname?: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, nickname }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || '注册失败，请更换账号名重试' };
      }

      const receivedToken = data.token || data.data?.token;
      const receivedUser = data.user || data.data?.user;

      setToken(receivedToken);
      setUser(receivedUser);
      localStorage.setItem(TOKEN_KEY, receivedToken);
      localStorage.setItem(USER_KEY, JSON.stringify(receivedUser));
      resetSocket();

      return { success: true };
    } catch (err: any) {
      return { success: false, error: '无法连接到认证服务器，请确认服务端已启动且网络通畅' };
    }
  };

  const updateNickname = async (newNickname: string): Promise<{ success: boolean; error?: string }> => {
    if (!token) {
      return { success: false, error: '未登录' };
    }
    try {
      const res = await fetch(apiUrl('/api/auth/profile'), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ nickname: newNickname }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        return { success: false, error: data.error || '更新指挥官名称失败' };
      }

      const updatedUser = data.user || data.data?.user || (user ? { ...user, nickname: newNickname } : null);
      const newToken = data.token || data.data?.token || token;

      if (updatedUser) {
        setUser(updatedUser);
        localStorage.setItem(USER_KEY, JSON.stringify(updatedUser));
      }
      if (newToken) {
        setToken(newToken);
        localStorage.setItem(TOKEN_KEY, newToken);
      }
      resetSocket();

      return { success: true };
    } catch (err: any) {
      return { success: false, error: '网络错误，更新名称失败' };
    }
  };

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch {}
    resetSocket();
  }, []);

  const authFetch = useCallback(
    async (url: string, options?: RequestInit): Promise<Response> => {
      const headers = new Headers(options?.headers || {});
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      return fetch(apiUrl(url), {
        ...options,
        headers,
      });
    },
    [token]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        isLoading,
        isAdmin: user?.role === 'ADMIN',
        isLoggedIn: !!user && !!token,
        login,
        register,
        updateNickname,
        logout,
        authFetch,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
