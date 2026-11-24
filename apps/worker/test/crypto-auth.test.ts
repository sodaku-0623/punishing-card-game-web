import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, signJwt, verifyJwt, getJwtSecret } from '../src/lib/crypto-auth.js';

describe('密码与 JWT 工具 (Web Crypto)', () => {
  it('密码使用 PBKDF2 + 随机盐存储，并能正确校验', async () => {
    const hash1 = await hashPassword('secret-123');
    const hash2 = await hashPassword('secret-123');
    expect(hash1.startsWith('pbkdf2:')).toBe(true);
    expect(hash1).not.toBe(hash2);
    expect(await verifyPassword('secret-123', hash1)).toEqual({ ok: true, needsRehash: false });
    expect((await verifyPassword('wrong', hash1)).ok).toBe(false);
  });

  it('兼容旧版 HMAC 摘要并提示升级', async () => {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode('zhanshuang_tcg_salt_2026'),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('old-pass')));
    const legacy = Array.from(sig, (b) => b.toString(16).padStart(2, '0')).join('');
    expect(await verifyPassword('old-pass', legacy)).toEqual({ ok: true, needsRehash: true });
    expect((await verifyPassword('nope', legacy)).ok).toBe(false);
  });

  it('JWT 签发与校验；支持 GUEST 角色，且拒绝篡改、过期及非 HS256 算法令牌', async () => {
    const secret = 'unit-test-secret-0123456789';
    const token = await signJwt({ sub: 'u1', username: 'alice', nickname: '爱丽丝', role: 'USER' }, secret);
    expect((await verifyJwt(token, secret))?.sub).toBe('u1');
    expect(await verifyJwt(token, 'another-secret-0123456789')).toBeNull();
    const expired = await signJwt({ sub: 'u1', username: 'a', nickname: 'a', role: 'USER', exp: 1 }, secret);
    expect(await verifyJwt(expired, secret)).toBeNull();

    const guestToken = await signJwt(
      { sub: 'guest_abc123', username: 'guest_abc123', nickname: '访客', role: 'GUEST', isGuest: true },
      secret
    );
    const verifiedGuest = await verifyJwt(guestToken, secret);
    expect(verifiedGuest?.role).toBe('GUEST');
    expect(verifiedGuest?.isGuest).toBe(true);

    // 篡改 alg 头为 none 并重新签名 (即使签名校验过也应因 alg !== 'HS256' 被拒绝)
    const parts = token.split('.');
    const badHeader = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(await verifyJwt(`${badHeader}.${parts[1]}.${parts[2]}`, secret)).toBeNull();
  });

  it('未配置或过短的 JWT_SECRET 不会回退到默认密钥', () => {
    expect(getJwtSecret({})).toBeNull();
    expect(getJwtSecret({ JWT_SECRET: '' })).toBeNull();
    expect(getJwtSecret({ JWT_SECRET: 'short' })).toBeNull();
    expect(getJwtSecret({ JWT_SECRET: 'a-long-enough-secret' })).toBe('a-long-enough-secret');
  });
});
