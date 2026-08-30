import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = () => {
  const headers = new Headers({ Location: '/admin/' });
  headers.append('Set-Cookie', 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0');
  return new Response(null, { status: 302, headers });
};
