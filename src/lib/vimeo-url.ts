/** Extract Vimeo numeric video id from common URL shapes (or bare digits). */
export function parseVimeoId(raw: string): string | null {
  const t = raw.trim();
  if (/^\d{6,12}$/.test(t)) return t;

  try {
    const u = new URL(t);
    const host = u.hostname.replace(/^www\./i, '').toLowerCase();

    if (host === 'player.vimeo.com') {
      const m = u.pathname.match(/\/video\/(\d{6,12})/);
      return m?.[1] ?? null;
    }

    if (host === 'vimeo.com') {
      const parts = u.pathname.split('/').filter(Boolean);
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        if (/^\d{6,12}$/.test(p)) return p;
      }
    }
  } catch {
    return null;
  }

  return null;
}
