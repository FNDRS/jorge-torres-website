/** Extract YouTube video id from common URL shapes (or bare 11-char id). */
export function parseYoutubeVideoId(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;

  if (/^[\w-]{11}$/.test(t)) return t;

  try {
    const u = new URL(t);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'youtu.be') {
      const id = u.pathname.replace(/^\//, '').split('/')[0];
      return id && /^[\w-]{11}$/.test(id) ? id : null;
    }

    if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'music.youtube.com') {
      if (u.pathname.startsWith('/shorts/')) {
        const id = u.pathname.split('/')[2];
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
      if (u.pathname.startsWith('/embed/')) {
        const id = u.pathname.split('/')[2];
        return id && /^[\w-]{11}$/.test(id) ? id : null;
      }
      if (u.pathname === '/watch' || u.pathname.startsWith('/watch/')) {
        const v = u.searchParams.get('v');
        return v && /^[\w-]{11}$/.test(v) ? v : null;
      }
    }
  } catch {
    return null;
  }

  return null;
}
