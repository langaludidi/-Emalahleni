import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
export interface AuthConfig { NEON_AUTH_BASE_URL?: string; NEON_AUTH_JWKS_URL?: string; }
const keys = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function actorFrom(request: Request, config: AuthConfig, testKey?: JWTVerifyGetKey): Promise<string> {
  const token = request.headers.get('Authorization');
  if (!token?.startsWith('Bearer ') || token.length > 8192) throw new Error('UNAUTHENTICATED');
  if (!config.NEON_AUTH_BASE_URL || !config.NEON_AUTH_JWKS_URL) throw new Error('AUTH_UNCONFIGURED');
  const issuer = new URL(config.NEON_AUTH_BASE_URL).origin;
  const url = new URL(config.NEON_AUTH_JWKS_URL);
  if (url.protocol !== 'https:' || url.origin !== issuer) throw new Error('AUTH_UNCONFIGURED');
  if (!keys.has(url.href)) keys.set(url.href, createRemoteJWKSet(url));
  const { payload } = await jwtVerify(token.slice(7), testKey ?? keys.get(url.href)!, {
    issuer, algorithms: ['EdDSA'], requiredClaims: ['sub', 'exp', 'iat'], maxTokenAge: '16m', clockTolerance: 5
  });
  if (!payload.sub || payload.sub.length > 250 || payload.isAnonymous === true || payload.role === 'anonymous') throw new Error('UNAUTHENTICATED');
  return payload.sub;
}
