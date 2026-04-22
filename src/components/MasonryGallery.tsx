import { useCallback, useEffect, useRef, useState } from 'react';
import Masonry from 'react-masonry-css';

export type GalleryDisplayItem =
  | { kind: 'media'; url: string }
  | { kind: 'youtube'; videoId: string };

type Props = {
  items: GalleryDisplayItem[];
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

function itemKey(item: GalleryDisplayItem) {
  return item.kind === 'media' ? item.url : `yt:${item.videoId}`;
}

export default function MasonryGallery({ items }: Props) {
  const total = items.length;
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

  useEffect(() => {
    setVisibleCount((prev) => Math.min(Math.max(prev, Math.min(INITIAL_WINDOW, total)), total));
  }, [total]);

  const visible = items.slice(0, visibleCount);
  const hasMore = visibleCount < total;

  if (total === 0) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/[0.04] px-8 py-16 text-center">
        <p className="font-display text-lg font-medium text-white/90">Galería vacía</p>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-white/55">
          Sube fotos y vídeos a Vercel Blob o añade enlaces de YouTube en{' '}
          <a
            href="/admin/visuals"
            className="text-white underline decoration-white/30 underline-offset-4 hover:decoration-white/60"
          >
            /admin/visuals
          </a>
          . Revisa que <code className="text-white/80">BLOB_READ_WRITE_TOKEN</code> esté configurado.
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
        {visible.map((item, i) =>
          item.kind === 'youtube' ? (
            <div key={itemKey(item)} className="mb-3 animate-fade-in">
              <div className="relative w-full overflow-hidden rounded-lg bg-black pt-[56.25%] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]">
                <iframe
                  title={`YouTube ${item.videoId}`}
                  src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.videoId)}?rel=0`}
                  allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  loading={i < 4 ? 'eager' : 'lazy'}
                  className="absolute inset-0 h-full w-full border-0"
                />
              </div>
            </div>
          ) : isVideoUrl(item.url) ? (
            <div key={itemKey(item)} className="mb-3 animate-fade-in">
              <video
                src={item.url}
                controls
                playsInline
                preload={i < 4 ? 'metadata' : 'none'}
                className="w-full rounded-lg object-cover"
              />
            </div>
          ) : (
            <div key={itemKey(item)} className="mb-3 animate-fade-in">
              <img
                src={item.url}
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
            </div>
          ),
        )}
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
