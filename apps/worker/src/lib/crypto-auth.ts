/**
 * Web Crypto 原生硬件加速密码哈希与 JWT 身份认证
 * 严格契合 Cloudflare Workers 10ms CPU 限制：
 * 1. 使用 PBKDF2-HMAC-SHA256，10,000 次迭代，每用户 16 字节随机盐；
 * 2. CPU 耗时仅 1~2ms，杜绝 scrypt 导致 Workers CPU 超限；
 * 3. 严格遵循 AGENTS.md 规范：禁止硬编码默认密钥，密码不可逆加密，时序安全对比。
 */

const PBKDF2_PREFIX = 'pbkdf2';
const DEFAULT_ITERATIONS = 10000;
const HASH_LENGTH = 32; // 256 bits

function bufferToHex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i]!.toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBuffer(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

/**
 * 生成安全的随机盐哈希密码，格式: pbkdf2:<iterations>:<saltHex>:<hashHex>
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: DEFAULT_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    HASH_LENGTH * 8
  );

  return `${PBKDF2_PREFIX}:${DEFAULT_ITERATIONS}:${bufferToHex(salt)}:${bufferToHex(derivedBits)}`;
}

/**
 * 校验密码有效性，同时支持旧版 SHA256 摘要平滑兼容
 */
export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<{ ok: boolean; needsRehash: boolean }> {
  if (storedHash.startsWith(`${PBKDF2_PREFIX}:`)) {
    const parts = storedHash.split(':');
    if (parts.length !== 4) return { ok: false, needsRehash: false };
    const iterations = parseInt(parts[1]!, 10);
    const salt = hexToBuffer(parts[2]!);
    const expectedHash = hexToBuffer(parts[3]!);

    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveBits']
    );

    const derivedBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations,
        hash: 'SHA-256',
      },
      keyMaterial,
      expectedHash.length * 8
    );

    const ok = timingSafeEqual(new Uint8Array(derivedBits), expectedHash);
    return { ok, needsRehash: false };
  }

  // 旧版 HMAC / SHA256 摘要兼容
  const encoder = new TextEncoder();
  const legacyKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode('zhanshuang_tcg_salt_2026'),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', legacyKey, encoder.encode(password));
  const computedHex = bufferToHex(signature);
  const expectedBuf = hexToBuffer(storedHash);
  const computedBuf = hexToBuffer(computedHex);
  const ok = timingSafeEqual(expectedBuf, computedBuf);
  return { ok, needsRehash: ok };
}

export interface JwtPayload {
  sub: string; // userId
  username: string;
  nickname: string;
  role: 'USER' | 'ADMIN';
  iat?: number;
  exp?: number;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(base64url: string): Uint8Array {
  let base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) {
    base64 += '=';
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8ToBase64Url(str: string): string {
  return bytesToBase64Url(new TextEncoder().encode(str));
}

function base64UrlToUtf8(base64url: string): string {
  return new TextDecoder().decode(base64UrlToBytes(base64url));
}

/**
 * 签发 HS256 JWT 令牌（默认 7 天有效期）
 */
export async function signJwt(payload: JwtPayload, secret: string): Promise<string> {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload: JwtPayload = {
    ...payload,
    iat: payload.iat ?? now,
    exp: payload.exp ?? now + 7 * 86400, // 7 days
  };

  const encodedHeader = utf8ToBase64Url(JSON.stringify(header));
  const encodedPayload = utf8ToBase64Url(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  const encodedSignature = bytesToBase64Url(new Uint8Array(signature));

  return `${data}.${encodedSignature}`;
}

/**
 * 校验 HS256 JWT 令牌
 */
export async function verifyJwt(token: string, secret: string): Promise<JwtPayload | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;
    const data = `${headerB64}.${payloadB64}`;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = base64UrlToBytes(sigB64!);
    const isValid = await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(data));
    if (!isValid) return null;

    const payload = JSON.parse(base64UrlToUtf8(payloadB64!)) as JwtPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Token 过期
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * 读取 JWT 签名密钥。未配置时返回 null —— 绝不回退到源码中的默认值，
 * 否则任何人都能用公开的默认密钥伪造管理员令牌。
 */
export function getJwtSecret(env: { JWT_SECRET?: string }): string | null {
  const secret = env.JWT_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}
