// Cloudflare Pages Functions middleware for Basic Authentication

interface Env {
  BASIC_AUTH_CREDENTIAL?: string; // "user:pass" format
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  // Skip auth if credential is not configured (local dev without .dev.vars)
  if (!env.BASIC_AUTH_CREDENTIAL) {
    return context.next();
  }

  const authorization = request.headers.get('Authorization');

  if (!authorization) {
    return new Response('Authentication required', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Kessan Scope", charset="UTF-8"',
      },
    });
  }

  const [scheme, encoded] = authorization.split(' ');

  if (scheme !== 'Basic' || !encoded) {
    return new Response('Invalid authentication', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Kessan Scope", charset="UTF-8"',
      },
    });
  }

  const decoded = atob(encoded);

  if (decoded !== env.BASIC_AUTH_CREDENTIAL) {
    return new Response('Invalid credentials', {
      status: 401,
      headers: {
        'WWW-Authenticate': 'Basic realm="Kessan Scope", charset="UTF-8"',
      },
    });
  }

  return context.next();
};
