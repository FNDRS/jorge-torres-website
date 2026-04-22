import { useCallback, useEffect, useRef, useState } from 'react';
import Masonry from 'react-masonry-css';

type Props = {
  images: string[];
};

const breakpointColumns = {
  default: 4,
  1280: 4,
  1024: 3,
  768: 2,
  640: 2,
};

/**
 * “Runway” gallery loader: first paint stays cheap, then chunks unlock as the
 * sentinel crosses the viewport. rootMargin preloads the next chunk before the
 * user hits the bottom so scroll feels continuous.
 */
const INITIAL_WINDOW = 12;
const SCROLL_CHUNK = 10;
/** bottom-heavy margin so the next batch starts while still ~1–2 screens away */
const RUNWAY_ROOT_MARGIN = '0px 0px 720px 0px';

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url);
}

export default function MasonryGallery({ images }: Props) {
  const total = images.length;
  const [visibleCount, setVisibleCount] = useState(() => Math.min(INITIAL_WINDOW, total));
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const unlockRef = useRef(false);

  const commitNextChunk = useCallback(() => {
    setVisibleCount((prev) => {
      if (prev >= total) return prev;
      return Math.min(prev + SCROLL_CHUNK, total);
    });
  }, [total]);

  useEffect(() => {
    unlockRef.current = false;
  }, [visibleCount]);

  useEffect(() => {
    if (visibleCount >= total) return;

    const node = sentinelRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        const crossing = entries.some((e) => e.isIntersecting);
        if (!crossing || unlockRef.current) return;
        unlockRef.current = true;
        commitNextChunk();
      },
      { root: null, rootMargin: RUNWAY_ROOT_MARGIN, threshold: 0 },
    );

    io.observe(node);
    return () => io.disconnect();
  }, [visibleCount, total, commitNextChunk]);

  const visible = images.slice(0, visibleCount);
  const hasMore = visibleCount < total;

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-16 text-center">
        <p className="font-display text-lg font-medium text-white/90">Galería vacía</p>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-white/55">
          Las fotos y videos salen solo de Vercel Blob. Sube archivos en{' '}
          <a href="/admin/visuals" className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white/60">
            /admin/visuals
          </a>{' '}
          y revisa que <code className="text-white/80">BLOB_READ_WRITE_TOKEN</code> esté configurado.
        </p>
      </div>
    );
  }

  return (
    <>
      <Masonry
        breakpointCols={breakpointColumns}
        className="masonry-grid"
        columnClassName="masonry-column"
      >
        {visible.map((src, i) => (
          <div key={src} className="mb-3 animate-fade-in">
            {isVideoUrl(src) ? (
              <video
                src={src}
                controls
                playsInline
                preload={i < 4 ? 'metadata' : 'none'}
                className="w-full rounded-lg object-cover"
              />
            ) : (
              <img
                src={src}
                alt=""
                decoding="async"
                loading={i < 6 ? 'eager' : 'lazy'}
                ref={(el) => {
                  if (!el) return;
                  if (i < 3) el.setAttribute('fetchpriority', 'high');
                  else el.removeAttribute('fetchpriority');
                }}
                className="w-full rounded-lg object-cover"
              />
            )}
          </div>
        ))}
      </Masonry>

      {hasMore ? (
        <div
          ref={sentinelRef}
          className="pointer-events-none mx-auto mt-6 h-8 w-full max-w-[120px] opacity-0"
          aria-hidden
        />
      ) : null}
    </>
  );
}
