// Real verification of a Pi Network access token.
//
// The client calls Pi.authenticate() (Pi SDK, only available inside the Pi
// Browser) to get an accessToken, then POSTs it here. We do NOT trust the
// client's claim of who they are — we call Pi's own API with that token and
// only trust what Pi's servers hand back.
//
// Docs: https://github.com/pi-apps/pi-platform-docs/blob/master/authentication.md

async function verifyPiToken(accessToken) {
  if (!accessToken || typeof accessToken !== 'string') {
    throw new Error('Missing Pi access token');
  }

  const base = process.env.PI_API_BASE || 'https://api.minepi.com';
  const res = await fetch(`${base}/v2/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (res.status !== 200) {
    const body = await res.text().catch(() => '');
    throw new Error(`Pi token verification failed (${res.status}): ${body}`);
  }

  const piUser = await res.json();
  // Pi's /v2/me response looks like: { uid: '...', username: '...', credentials: { scopes, valid_until } }
  if (!piUser || !piUser.uid || !piUser.username) {
    throw new Error('Unexpected response from Pi API');
  }

  return {
    providerUid: piUser.uid,
    name: piUser.username,
    handle: piUser.username,
  };
}

module.exports = { verifyPiToken };
