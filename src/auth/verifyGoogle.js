// Real verification of a Google Sign-In ID token (a signed JWT) using
// Google's official client library, which fetches Google's public keys and
// checks the signature, audience (your client ID), issuer and expiry.
//
// Docs: https://developers.google.com/identity/gsi/web/guides/verify-google-id-token

const { OAuth2Client } = require('google-auth-library');

let client = null;
function getClient() {
  if (!client) client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
  return client;
}

async function verifyGoogleToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing Google ID token');
  }
  if (!process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID.includes('your-google-client-id')) {
    throw new Error('Server is not configured with a real GOOGLE_CLIENT_ID yet (see .env.example)');
  }

  const ticket = await getClient().verifyIdToken({
    idToken,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.sub) {
    throw new Error('Invalid Google token payload');
  }

  return {
    providerUid: payload.sub,
    name: payload.name || payload.email || 'Google User',
    handle: (payload.email || payload.sub).split('@')[0],
  };
}

module.exports = { verifyGoogleToken };
