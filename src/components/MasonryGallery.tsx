import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Masonry from 'react-masonry-css';
import type { PublicGalleryItem } from '../lib/blob-visuals';
import { VISUAL_GALLERY_IMAGE_SIZES_ATTR } from '../lib/visuals-photo-sizes';

export type GalleryDisplayItem = PublicGalleryItem;

type Props = {
  items: GalleryDisplayItem[];
};

type VisualsMode = 'photos' | 'videos';

/** Single column under the video so images fill the gap below it. */
const sidebarLeftColumns = {
  default: 1,
  1280: 1,
  1024: 1,
  768: 1,
  640: 1,
};

/**
 * react-masonry-css assigns round-robin to N columns (no “shortest column” packing).
 * Never use more columns than items, or you get empty vertical strips (e.g. 1 tile in 2 cols = 50% void).
 */
function masonryColsForCount(n: number) {
  const capped = Math.min(4, Math.max(1, n));
  /* react-masonry-css: smallest numeric breakpoint where windowWidth <= key wins; `default` = widest. */
  return {
    default: Math.min(capped, 4),
    1280: Math.min(capped, 4),
    1024: Math.min(capped, 3),
    768: Math.min(capped, 2),
    640: Math.min(capped, 2),
    480: 1,
  };
}

/** Same radius as stills; `isolate` helps iframes respect `overflow-hidden` clipping. `min-w-0` avoids flex/grid overflow on narrow viewports. */
const VIDEO_TILE =
  'aspect-video min-h-0 min-w-0 w-full max-w-full overflow-hidden rounded-xl bg-black shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] isolate';

const PHOTO_ROUNDED = 'rounded-xl';

type ItemRun =
  | { type: 'images'; items: GalleryDisplayItem[]; key: string }
  | { type: 'videos'; items: GalleryDisplayItem[]; key: string };

type DisplaySegment =
  | { type: 'images'; key: string; items: GalleryDisplayItem[] }
  | { type: 'videos'; key: string; items: GalleryDisplayItem[] }
  | { type: 'videoSidebar'; key: string; video: GalleryDisplayItem; images: GalleryDisplayItem[] };

/**
 * “Runway” gallery loader: first paint stays cheap, then chunks unlock as the
 * sentinel crosses the viewport. rootMargin preloads the next chunk before the
 * user hits the bottom so scroll feels continuous.
 */
const INITIAL_WINDOW = 8;
const SCROLL_CHUNK = 10;
/** bottom-heavy margin so the next batch starts while still ~1–2 screens away */
const RUNWAY_ROOT_MARGIN = '0px 0px 720px 0px';
/** Image tiles: only set `img.src` after this zone intersects the viewport (no network until then). */
const IMAGE_IO_ROOT_MARGIN = '200px 16px 560px 16px';

function isVideoUrl(url: string) {
  return /\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url);
}

function isGalleryVideo(item: GalleryDisplayItem): boolean {
  if (item.kind === 'youtube' || item.kind === 'vimeo') return true;
  return item.kind === 'media' && isVideoUrl(item.url);
}

function itemKey(item: GalleryDisplayItem) {
  if (item.kind === 'media') {
    if (item.packId) return `pack:${item.packId}`;
    return item.url;
  }
  if (item.kind === 'vimeo') return `vimeo:${item.videoId}`;
  return `yt:${item.videoId}`;
}

/**
 * Masonry still: skeleton until IntersectionObserver allows load, then fade-in when decoded.
 * No `img` / no network until the tile enters the expanded viewport band.
 */
function GalleryImageWithSkeleton({ item, eagerIndex }: { item: GalleryDisplayItem; eagerIndex: number }) {
  const url = item.kind === 'media' ? item.url : '';
  const image = item.kind === 'media' ? item.image : undefined;
  const stableKey = item.kind === 'media' ? (item.packId ?? item.url) : '';
  const [inView, setInView] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const avifSrcSet = useMemo(
    () => (image?.variants.map((v) => `${v.avif} ${v.w}w`).join(', ') ?? ''),
    [image],
  );
  const webpSrcSet = useMemo(
    () => (image?.variants.map((v) => `${v.webp} ${v.w}w`).join(', ') ?? ''),
    [image],
  );
  const fallbackWebp = image?.variants[image.variants.length - 1]?.webp ?? url;
  const intrinsicW = image?.width;
  const intrinsicH = image?.height;

  useEffect(() => {
    setInView(false);
    setLoaded(false);
  }, [stableKey]);

  useEffect(() => {
    if (!url) return;
    const node = wrapRef.current;
    if (!node) return;
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { root: null, rootMargin: IMAGE_IO_ROOT_MARGIN, threshold: 0 },
    );
    io.observe(node);
    return () => io.disconnect();
  }, [stableKey, url]);

  useLayoutEffect(() => {
    if (!inView) return;
    const el = imgRef.current;
    if (el?.complete && el.naturalHeight > 0) setLoaded(true);
  }, [inView, stableKey]);

  const setImgRef = (el: HTMLImageElement | null) => {
    imgRef.current = el;
    if (!el) return;
    if (eagerIndex < 3) el.setAttribute('fetchpriority', 'high');
    else el.removeAttribute('fetchpriority');
    if (el.complete && el.naturalHeight > 0) setLoaded(true);
  };

  if (!url) {
    return (
      <div className="mb-3 min-w-0 animate-fade-in">
        <div
          className={`relative min-h-[11rem] overflow-hidden ${PHOTO_ROUNDED} bg-white/[0.04] sm:min-h-[13rem]`}
          aria-hidden
        />
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="mb-3 min-w-0 animate-fade-in">
      <div
        className={`relative isolate overflow-hidden ${PHOTO_ROUNDED} bg-white/[0.04] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)] ${
          loaded ? '' : 'min-h-[11rem] sm:min-h-[13rem]'
        }`}
      >
        {!loaded ? (
          <div className="gallery-img-skeleton-track z-0" aria-hidden>
            {image?.lqip ? (
              <img
                src={image.lqip}
                alt=""
                className={`absolute inset-0 z-[1] h-full w-full scale-110 object-cover opacity-55 blur-2xl ${PHOTO_ROUNDED}`}
              />
            ) : null}
            <div className={`absolute inset-0 z-[1] ${PHOTO_ROUNDED} bg-zinc-800/90`} />
            <div className={`gallery-img-skeleton-shimmer z-[2] ${PHOTO_ROUNDED}`} />
          </div>
        ) : null}
        {inView ? (
          image && avifSrcSet && webpSrcSet ? (
            <picture>
              <source type="image/avif" srcSet={avifSrcSet} sizes={VISUAL_GALLERY_IMAGE_SIZES_ATTR} />
              <source type="image/webp" srcSet={webpSrcSet} sizes={VISUAL_GALLERY_IMAGE_SIZES_ATTR} />
              <img
                ref={setImgRef}
                src={fallbackWebp}
                srcSet={webpSrcSet}
                sizes={VISUAL_GALLERY_IMAGE_SIZES_ATTR}
                width={intrinsicW}
                height={intrinsicH}
                alt=""
                decoding="async"
                loading={eagerIndex < 6 ? 'eager' : 'lazy'}
                onLoad={() => setLoaded(true)}
                onError={() => setLoaded(true)}
                className={`relative z-10 block h-auto w-full max-w-full ${PHOTO_ROUNDED} transition-opacity duration-500 ease-out ${
                  loaded ? 'opacity-100' : 'opacity-0'
                }`}
              />
            </picture>
          ) : (
            <img
              ref={setImgRef}
              src={url}
              alt=""
              decoding="async"
              loading={eagerIndex < 6 ? 'eager' : 'lazy'}
              onLoad={() => setLoaded(true)}
              onError={() => setLoaded(true)}
              className={`relative z-10 block h-auto w-full max-w-full ${PHOTO_ROUNDED} transition-opacity duration-500 ease-out ${
                loaded ? 'opacity-100' : 'opacity-0'
              }`}
            />
          )
        ) : null}
      </div>
    </div>
  );
}

/**
 * YouTube embed: modest branding, white progress bar, no annotations.
 * controls=0 keeps the bar minimal (tap / click on the video still pauses in most browsers).
 */
const YT_EMBED_QUERY =
  'rel=0&modestbranding=1&controls=0&color=white&iv_load_policy=3&playsinline=1&cc_load_policy=0';

function youtubeThumbUrls(videoId: string) {
  const id = encodeURIComponent(videoId);
  return [
    `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    `https://i.ytimg.com/vi/${id}/sddefault.jpg`,
    `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
  ] as const;
}

function YoutubeEmbed({ videoId, priority }: { videoId: string; priority: boolean }) {
  const [active, setActive] = useState(false);
  const [thumbStep, setThumbStep] = useState(0);
  const thumbs = useMemo(() => [...youtubeThumbUrls(videoId)], [videoId]);
  const posterSrc = thumbs[Math.min(thumbStep, thumbs.length - 1)]!;

  if (!active) {
    return (
      <div className={VIDEO_TILE}>
        <button
          type="button"
          onClick={() => setActive(true)}
          aria-label="Reproducir vídeo"
          className={`touch-manipulation group relative block h-full min-h-0 w-full min-w-0 max-w-full overflow-hidden text-left ${PHOTO_ROUNDED}`}
        >
          <img
            key={posterSrc}
            src={posterSrc}
            alt=""
            width={1280}
            height={720}
            sizes="(min-width: 1024px) 50vw, 100vw"
            decoding="async"
            loading={priority ? 'eager' : 'lazy'}
            onError={() =>
              setThumbStep((s) => {
                if (s >= thumbs.length - 1) return s;
                return s + 1;
              })
            }
            onLoad={(e) => {
              if (thumbStep === 0 && e.currentTarget.naturalWidth > 0 && e.currentTarget.naturalWidth < 400) {
                setThumbStep(2);
              }
            }}
            className={`h-full min-h-0 w-full min-w-0 max-w-full object-cover opacity-95 transition duration-300 group-hover:opacity-100 ${PHOTO_ROUNDED}`}
          />
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-black/25">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-neutral-900 shadow-[0_8px_32px_rgba(0,0,0,0.45)] ring-2 ring-white/50 transition duration-200 group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={VIDEO_TILE}>
      <iframe
        title={`Vídeo ${videoId}`}
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1&${YT_EMBED_QUERY}`}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
        allowFullScreen
        loading="lazy"
        className={`h-full min-h-0 w-full min-w-0 max-w-full border-0 ${PHOTO_ROUNDED}`}
      />
    </div>
  );
}

const VIMEO_EMBED_QUERY = 'autoplay=1&dnt=1&title=0&byline=0&portrait=0&background=0';

function VimeoEmbed({ videoId, priority }: { videoId: string; priority: boolean }) {
  const [active, setActive] = useState(false);
  const [poster, setPoster] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const pageUrl = `https://vimeo.com/${encodeURIComponent(videoId)}`;
    const oembed = `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(pageUrl)}&width=1920&height=1080`;
    fetch(oembed)
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { thumbnail_url?: string } | null) => {
        if (!cancelled && j?.thumbnail_url) setPoster(j.thumbnail_url);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [videoId]);

  if (!active) {
    return (
      <div className={VIDEO_TILE}>
        <button
          type="button"
          onClick={() => setActive(true)}
          aria-label="Reproducir vídeo de Vimeo"
          className={`touch-manipulation group relative block h-full min-h-0 w-full min-w-0 max-w-full overflow-hidden text-left ${PHOTO_ROUNDED}`}
        >
          {poster ? (
            <img
              src={poster}
              alt=""
              width={1920}
              height={1080}
              sizes="(min-width: 1024px) 50vw, 100vw"
              decoding="async"
              loading={priority ? 'eager' : 'lazy'}
              className={`h-full min-h-0 w-full min-w-0 max-w-full object-cover opacity-95 transition duration-300 group-hover:opacity-100 ${PHOTO_ROUNDED}`}
            />
          ) : (
            <div className={`h-full min-h-[12rem] w-full min-w-0 max-w-full bg-zinc-900 ${PHOTO_ROUNDED}`} />
          )}
          <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/15 transition group-hover:bg-black/25">
            <span className="flex h-16 w-16 items-center justify-center rounded-full bg-white/95 text-neutral-900 shadow-[0_8px_32px_rgba(0,0,0,0.45)] ring-2 ring-white/50 transition duration-200 group-hover:scale-105">
              <svg viewBox="0 0 24 24" className="ml-1 h-8 w-8" fill="currentColor" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className={VIDEO_TILE}>
      <iframe
        title={`Vimeo ${videoId}`}
        src={`https://player.vimeo.com/video/${encodeURIComponent(videoId)}?${VIMEO_EMBED_QUERY}`}
        allow="autoplay; fullscreen; picture-in-picture"
        allowFullScreen
        loading="lazy"
        className={`h-full min-h-0 w-full min-w-0 max-w-full border-0 ${PHOTO_ROUNDED}`}
      />
    </div>
  );
}

function StreamVideoTile({ item, priority }: { item: GalleryDisplayItem; priority: boolean }) {
  if (item.kind === 'youtube') return <YoutubeEmbed videoId={item.videoId} priority={priority} />;
  if (item.kind === 'vimeo') return <VimeoEmbed videoId={item.videoId} priority={priority} />;
  return <VideoBlobTile url={item.url} priority={priority} />;
}

/** Consecutive items of the same “lane” (images vs fixed-aspect videos). */
function buildRuns(slice: GalleryDisplayItem[]): ItemRun[] {
  const runs: ItemRun[] = [];
  let imageBuf: GalleryDisplayItem[] = [];
  let videoBuf: GalleryDisplayItem[] = [];

  const flushImages = () => {
    if (!imageBuf.length) return;
    runs.push({
      type: 'images',
      items: imageBuf,
      key: `i-${itemKey(imageBuf[0])}-${imageBuf.length}`,
    });
    imageBuf = [];
  };
  const flushVideos = () => {
    if (!videoBuf.length) return;
    runs.push({
      type: 'videos',
      items: videoBuf,
      key: `v-${itemKey(videoBuf[0])}-${videoBuf.length}`,
    });
    videoBuf = [];
  };

  for (const item of slice) {
    if (isGalleryVideo(item)) {
      flushImages();
      videoBuf.push(item);
    } else {
      flushVideos();
      imageBuf.push(item);
    }
  }
  flushVideos();
  flushImages();
  return runs;
}

/** One video + next image run → side-by-side so the 2-col grid does not leave a dead half. */
function mergeLoneVideoWithFollowingImages(runs: ItemRun[]): DisplaySegment[] {
  const out: DisplaySegment[] = [];
  let i = 0;
  while (i < runs.length) {
    const cur = runs[i];
    const next = runs[i + 1];
    if (
      cur.type === 'videos' &&
      cur.items.length === 1 &&
      next?.type === 'images' &&
      next.items.length > 0
    ) {
      out.push({
        type: 'videoSidebar',
        key: `vs-${itemKey(cur.items[0]!)}-${next.key}`,
        video: cur.items[0]!,
        images: next.items,
      });
      i += 2;
      continue;
    }
    if (cur.type === 'videos') {
      out.push({ type: 'videos', key: cur.key, items: cur.items });
    } else {
      out.push({ type: 'images', key: cur.key, items: cur.items });
    }
    i += 1;
  }
  return out;
}

function VideoBlobTile({ url, priority }: { url: string; priority: boolean }) {
  return (
    <div className={VIDEO_TILE}>
      <video
        src={url}
        controls
        playsInline
        preload={priority ? 'metadata' : 'none'}
        className={`h-full min-h-0 w-full min-w-0 max-w-full object-cover ${PHOTO_ROUNDED}`}
      />
    </div>
  );
}

function VisualsModeSwitch({
  mode,
  onChange,
  photoCount,
  videoCount,
}: {
  mode: VisualsMode;
  onChange: Dispatch<SetStateAction<VisualsMode>>;
  photoCount: number;
  videoCount: number;
}) {
  const pill =
    'inline-flex min-h-[44px] min-w-[5.5rem] shrink-0 touch-manipulation select-none items-center justify-center rounded-full px-4 py-2.5 text-sm font-medium transition-all duration-200 active:opacity-90 sm:min-w-[100px] sm:px-5';
  const inactive =
    'text-white/60 hover:bg-white/10 hover:text-white/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/50';
  const active =
    'bg-white/95 text-neutral-900 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70';

  return (
    <div
      className="mb-8 flex w-full min-w-0 justify-center px-0 sm:mb-10"
      role="tablist"
      aria-label="Tipo de contenido"
    >
      <div className="inline-flex max-w-full min-w-0 flex-nowrap gap-1 overflow-x-auto rounded-full border border-white/10 bg-white/[0.06] p-1 [-ms-overflow-style:none] [scrollbar-width:none] backdrop-blur-sm [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'photos'}
          id="visuals-tab-photos"
          aria-controls="visuals-panel"
          className={`${pill} ${mode === 'photos' ? active : inactive}`}
          onClick={() => onChange('photos')}
        >
          <span className="whitespace-nowrap">Fotos</span>
          {photoCount > 0 ? (
            <span className="ml-1 tabular-nums text-[11px] opacity-60 max-[360px]:hidden sm:ml-1.5">
              ({photoCount})
            </span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'videos'}
          id="visuals-tab-videos"
          aria-controls="visuals-panel"
          className={`${pill} ${mode === 'videos' ? active : inactive}`}
          onClick={() => onChange('videos')}
        >
          <span className="whitespace-nowrap">Vídeos</span>
          {videoCount > 0 ? (
            <span className="ml-1 tabular-nums text-[11px] opacity-60 max-[360px]:hidden sm:ml-1.5">
              ({videoCount})
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

export default function MasonryGallery({ items }: Props) {
  const [mode, setMode] = useState<VisualsMode>('photos');
  const photoItems = useMemo(() => items.filter((it) => !isGalleryVideo(it)), [items]);
  const videoItems = useMemo(() => items.filter((it) => isGalleryVideo(it)), [items]);
  const activeItems = mode === 'photos' ? photoItems : videoItems;
  const total = activeItems.length;

  const [visibleCount, setVisibleCount] = useState(() => Math.min(INITIAL_WINDOW, total));
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const unlockRef = useRef(false);

  useEffect(() => {
    const len = mode === 'photos' ? photoItems.length : videoItems.length;
    setVisibleCount(Math.min(INITIAL_WINDOW, len));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset runway only on tab change; omit lengths to avoid jump on new uploads
  }, [mode]);

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

  const visible = activeItems.slice(0, visibleCount);
  const hasMore = visibleCount < total;

  const runs = useMemo(() => buildRuns(visible), [visible]);
  const segments = useMemo(() => mergeLoneVideoWithFollowingImages(runs), [runs]);

  const indexByKey = useMemo(() => {
    const m = new Map<string, number>();
    visible.forEach((it, idx) => {
      m.set(itemKey(it), idx);
    });
    return m;
  }, [visible]);

  if (items.length === 0) {
    return (
      <div className="w-full min-w-0 max-w-full rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-14 text-center sm:px-8 sm:py-16">
        <p className="font-display text-lg font-medium text-white/90">Galería vacía</p>
        <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-white/55">
          Sube fotos y vídeos a Vercel Blob o añade enlaces de YouTube / Vimeo en{' '}
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

  if (total === 0) {
    const otherHas = mode === 'photos' ? videoItems.length > 0 : photoItems.length > 0;
    const hint =
      mode === 'photos'
        ? 'Aún no hay imágenes en la galería. Prueba la pestaña Vídeos o sube JPG/PNG/WebP desde el panel de administración.'
        : 'Aún no hay vídeos (YouTube, Vimeo o archivos de vídeo). Prueba la pestaña Fotos o añade enlaces en el panel de administración.';
    return (
      <div className="w-full min-w-0 max-w-full overflow-x-clip overscroll-y-contain">
        <VisualsModeSwitch
          mode={mode}
          onChange={setMode}
          photoCount={photoItems.length}
          videoCount={videoItems.length}
        />
        <div
          id="visuals-panel"
          role="tabpanel"
          aria-labelledby={mode === 'photos' ? 'visuals-tab-photos' : 'visuals-tab-videos'}
          className="rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-12 text-center sm:px-8 sm:py-14"
        >
          <p className="font-display text-lg font-medium text-white/90">
            {mode === 'photos' ? 'Sin fotos por ahora' : 'Sin vídeos por ahora'}
          </p>
          <p className="mx-auto mt-3 max-w-md text-[14px] leading-relaxed text-white/55">{hint}</p>
          {otherHas ? (
            <p className="mx-auto mt-4 max-w-md text-[13px] text-white/45">
              Hay contenido en la otra pestaña: usa el interruptor de arriba para verlo.
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  const videoGridClass = 'grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-5';

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip overscroll-y-contain">
      <VisualsModeSwitch
        mode={mode}
        onChange={setMode}
        photoCount={photoItems.length}
        videoCount={videoItems.length}
      />
      <div
        id="visuals-panel"
        role="tabpanel"
        aria-labelledby={mode === 'photos' ? 'visuals-tab-photos' : 'visuals-tab-videos'}
        className="space-y-5 sm:space-y-6"
      >
        {segments.map((seg) => {
          if (seg.type === 'images') {
            return (
              <div key={seg.key} className="mb-1 min-w-0">
                <Masonry
                  breakpointCols={masonryColsForCount(seg.items.length)}
                  className="masonry-grid"
                  columnClassName="masonry-column"
                >
                  {seg.items.map((item) => {
                    const i = indexByKey.get(itemKey(item)) ?? 0;
                    return <GalleryImageWithSkeleton key={itemKey(item)} item={item} eagerIndex={i} />;
                  })}
                </Masonry>
              </div>
            );
          }

          if (seg.type === 'videoSidebar') {
            const vi = indexByKey.get(itemKey(seg.video)) ?? 0;
            const leftImages = seg.images.filter((_, idx) => idx % 2 === 0);
            const rightImages = seg.images.filter((_, idx) => idx % 2 === 1);
            const hasRight = rightImages.length > 0;
            const rightMasonryCols =
              rightImages.length <= 1 ? sidebarLeftColumns : masonryColsForCount(rightImages.length);
            const leftMasonryCols =
              leftImages.length <= 1 ? sidebarLeftColumns : masonryColsForCount(leftImages.length);

            const eagerCutoff = 6;
            const renderSidebarImg = (item: GalleryDisplayItem, si: number) => (
              <GalleryImageWithSkeleton key={itemKey(item)} item={item} eagerIndex={si < eagerCutoff ? si : 99} />
            );

            return (
              <div
                key={seg.key}
                className="flex min-w-0 w-full flex-col gap-4 lg:flex-row lg:items-start lg:gap-4"
              >
                <div
                  className={`flex min-w-0 flex-col gap-3 ${hasRight ? 'w-full shrink-0 lg:w-1/2 lg:max-w-[50%]' : 'w-full'}`}
                >
                  <StreamVideoTile item={seg.video} priority={vi < 4} />
                  {leftImages.length > 0 ? (
                    <Masonry
                      breakpointCols={leftMasonryCols}
                      className="masonry-grid"
                      columnClassName="masonry-column"
                    >
                      {leftImages.map((item, si) => renderSidebarImg(item, si))}
                    </Masonry>
                  ) : null}
                </div>
                {hasRight ? (
                  <div className="min-w-0 w-full flex-1 lg:w-1/2">
                    <Masonry
                      breakpointCols={rightMasonryCols}
                      className="masonry-grid"
                      columnClassName="masonry-column"
                    >
                      {rightImages.map((item, si) => renderSidebarImg(item, si))}
                    </Masonry>
                  </div>
                ) : null}
              </div>
            );
          }

          const lone = seg.items.length === 1;
          const isVideosTab = mode === 'videos';
          return (
            <div
              key={seg.key}
              className={
                isVideosTab
                  ? videoGridClass
                  : lone
                    ? 'grid min-w-0 grid-cols-1'
                    : 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4'
              }
            >
              {seg.items.map((item) => {
                const i = indexByKey.get(itemKey(item)) ?? 0;
                return (
                  <div key={itemKey(item)} className="min-w-0 animate-fade-in">
                    <StreamVideoTile item={item} priority={i < 4} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {hasMore ? (
        <div
          ref={sentinelRef}
          className="pointer-events-none mx-auto mt-6 h-8 w-full max-w-[120px] opacity-0"
          aria-hidden
        />
      ) : null}
    </div>
  );
}
