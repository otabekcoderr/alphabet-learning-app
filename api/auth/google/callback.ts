import {
  generateAccountPublicId,
  generateAccountUuid,
  normalizeContactKey,
} from '../../_lib/crypto.js';
import {
  ensureSchema,
  ensureUserPublicId,
  getSql,
  isDbConfigured,
  isUniqueViolationError,
  type UserRow,
} from '../../_lib/db.js';
import {
  clearOAuthStateCookie,
  createSessionCookie,
  getRequestOrigin,
  readOAuthStateCookie,
} from '../../_lib/session.js';

function redirectWithCleanup(url: string, clearCookieHeader: string): Response {
  const headers = new Headers({
    Location: url,
    'Cache-Control': 'no-store',
  });
  headers.append('Set-Cookie', clearCookieHeader);
  return new Response(null, { status: 302, headers });
}

export async function GET(request: Request): Promise<Response> {
  const origin = getRequestOrigin(request);
  const clearState = clearOAuthStateCookie(request);

  if (!isDbConfigured()) {
    return redirectWithCleanup(`${origin}/?auth_error=db_not_configured`, clearState);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return redirectWithCleanup(`${origin}/?auth_error=google_not_configured`, clearState);
  }

  const reqUrl = new URL(request.url);
  const oauthErr = reqUrl.searchParams.get('error');
  if (oauthErr) {
    return redirectWithCleanup(`${origin}/?auth_error=google_cancelled`, clearState);
  }

  const code = reqUrl.searchParams.get('code');
  const state = reqUrl.searchParams.get('state');
  const savedCookie = readOAuthStateCookie(request);

  if (!code || !state || !savedCookie || savedCookie.state !== state) {
    return redirectWithCleanup(`${origin}/?auth_error=google_state_invalid`, clearState);
  }

  try {
    const redirectUri = `${origin}/api/auth/google/callback`;
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!tokenRes.ok) {
      return redirectWithCleanup(`${origin}/?auth_error=google_token_failed`, clearState);
    }

    const tokenData = (await tokenRes.json()) as { access_token?: string };
    if (!tokenData.access_token) {
      return redirectWithCleanup(`${origin}/?auth_error=google_token_failed`, clearState);
    }

    const userRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    if (!userRes.ok) {
      return redirectWithCleanup(`${origin}/?auth_error=google_userinfo_failed`, clearState);
    }

    const profile = (await userRes.json()) as {
      sub?: string;
      email?: string;
      name?: string;
      given_name?: string;
      picture?: string;
    };

    if (!profile.sub) {
      return redirectWithCleanup(`${origin}/?auth_error=google_userinfo_failed`, clearState);
    }

    const emailDisplay = profile.email?.trim() || '';
    const contactKey = emailDisplay ? normalizeContactKey(emailDisplay) : null;
    const contactDisplay = emailDisplay || profile.name?.trim() || `Google (${profile.sub.slice(0, 8)})`;
    const displayName = profile.name?.trim() || null;
    const avatarUrl = profile.picture?.trim() || null;

    await ensureSchema();
    const sql = getSql();

    let existingRows = (await sql`
      SELECT * FROM users WHERE google_id = ${profile.sub} LIMIT 1
    `) as UserRow[];

    if (existingRows.length === 0 && contactKey) {
      existingRows = (await sql`
        SELECT * FROM users WHERE contact_key = ${contactKey} LIMIT 1
      `) as UserRow[];
    }

    let user: UserRow | undefined = existingRows[0];

    if (user) {
      const updated = (await sql`
        UPDATE users
        SET
          google_id = COALESCE(google_id, ${profile.sub}),
          display_name = COALESCE(${displayName}, display_name),
          avatar_url = COALESCE(${avatarUrl}, avatar_url),
          updated_at = NOW()
        WHERE id = ${user.id}
        RETURNING *
      `) as UserRow[];
      user = await ensureUserPublicId(updated[0] ?? user);
    } else {
      const id = generateAccountUuid();
      const defaultChildName =
        savedCookie.childName || profile.given_name?.trim().slice(0, 20) || 'Bolajon';
      const defaultAvatarId = savedCookie.avatarId || 'fox';

      for (let attempt = 0; attempt < 5; attempt++) {
        const publicId = generateAccountPublicId();
        try {
          const inserted = (await sql`
            INSERT INTO users (
              id, public_id, provider, contact_key, contact_display, google_id, display_name, avatar_url, child_name, avatar_id
            )
            VALUES (
              ${id}, ${publicId}, 'google', ${contactKey}, ${contactDisplay}, ${profile.sub}, ${displayName}, ${avatarUrl}, ${defaultChildName}, ${defaultAvatarId}
            )
            RETURNING *
          `) as UserRow[];
          user = inserted[0];
          break;
        } catch (err) {
          if (isUniqueViolationError(err, 'public_id') && attempt < 4) {
            continue;
          }
          throw err;
        }
      }
    }

    if (!user) {
      return redirectWithCleanup(`${origin}/?auth_error=google_db_failed`, clearState);
    }

    const headers = new Headers({
      Location: `${origin}/?auth=google_ok`,
      'Cache-Control': 'no-store',
    });
    headers.append('Set-Cookie', clearState);
    headers.append('Set-Cookie', createSessionCookie(user.id, request));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    console.error('Google OAuth callback error:', err);
    return redirectWithCleanup(`${origin}/?auth_error=google_server_error`, clearState);
  }
}
