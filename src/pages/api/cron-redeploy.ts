import type { APIRoute } from 'astro';

export const prerender = false;

/**
 * Triggers a fresh production deploy on a schedule (see vercel.json `crons`), so the YouTube
 * title/description fetched at build time in local-visuals.ts stays in sync with what's actually
 * on YouTube without anyone needing to manually redeploy after editing a video there.
 */
export const GET: APIRoute = async ({ request }) => {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  const deployHookUrl = process.env.DEPLOY_HOOK_URL;
  if (!deployHookUrl) {
    return new Response('DEPLOY_HOOK_URL is not configured', { status: 500 });
  }

  const res = await fetch(deployHookUrl, { method: 'POST' });
  if (!res.ok) {
    return new Response(`Deploy hook failed: ${res.status}`, { status: 502 });
  }

  return new Response('Redeploy triggered', { status: 200 });
};
