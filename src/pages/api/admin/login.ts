import type { APIRoute } from 'astro';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json() as { password?: string };
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!adminPassword || body.password !== adminPassword) {
    return new Response(JSON.stringify({ ok: false }), { status: 401 });
  }

  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.append(
    'Set-Cookie',
    `admin_session=${encodeURIComponent(adminPassword)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
  );
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
};
