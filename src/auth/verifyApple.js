// Real verification of an Apple "Sign in with Apple" identity token (a
// signed JWT). Apple publishes its signing keys at a JWKS endpoint; we fetch
// those (cached) and verify the token's signature, issuer and audience
// ourselves using `jose`.
//
// Docs: https://developer.apple.com/documentation/sign_in_with_apple/verifying_a_user

const { createRemoteJWKSet, jwtVerify } = require('jose');

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

async function verifyAppleToken(identityToken) {
  if (!identityToken || typeof identityToken !== 'string') {
    throw new Error('Missing Apple identity token');
  }
  if (!process.env.APPLE_CLIENT_ID) {
    throw new Error('Server is not configured with a real APPLE_CLIENT_ID yet (see .env.example)');
  }

  const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
    issuer: APPLE_ISSUER,
    audience: process.env.APPLE_CLIENT_ID,
  });

  if (!payload || !payload.sub) {
    throw new Error('Invalid Apple token payload');
  }

  return {
    providerUid: payload.sub,
    name: payload.email ? payload.email.split('@')[0] : 'Apple User',
    handle: payload.sub.slice(0, 12),
  };
}

module.exports = { verifyAppleToken };
