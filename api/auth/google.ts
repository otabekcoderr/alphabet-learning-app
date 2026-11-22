import { isDbConfigured } from '../_lib/db.js';
import { createOAuthStateCookie, getRequestOrigin } from '../_lib/session.js';

export async function GET(request: Request): Promise<Response> {
  const origin = getRequestOrigin(request);

  if (!isDbConfigured()) {
    return Response.redirect(`${origin}/?auth_error=db_not_configured`, 302);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return Response.redirect(`${origin}/?auth_error=google_not_configured`, 302);
  }

  const reqUrl = new URL(request.url);
  const childName = (reqUrl.searchParams.get('childName') || '').trim().slice(0, 20) || undefined;
  const avatarId = (reqUrl.searchParams.get('avatarId') || '').trim().slice(0, 24) || undefined;

  const { state, cookie } = createOAuthStateCookie({ childName, avatarId }, request);
  const redirectUri = `${origin}/api/auth/google/callback`;

  const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  googleAuthUrl.searchParams.set('client_id', clientId);
  googleAuthUrl.searchParams.set('redirect_uri', redirectUri);
  googleAuthUrl.searchParams.set('response_type', 'code');
  googleAuthUrl.searchParams.set('scope', 'openid email profile');
  googleAuthUrl.searchParams.set('state', state);
  googleAuthUrl.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      Location: googleAuthUrl.toString(),
      'Set-Cookie': cookie,
      'Cache-Control': 'no-store',
    },
  });
}
