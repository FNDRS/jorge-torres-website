import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import { toast, Toaster } from 'sonner';

type AdminMeta = {
  usedBytes: number;
  mediaFileCount: number;
  quotaMB: number;
};

type GalleryItem = {
  url: string;
  pathname: string;
  size: number;
  uploadedAt: string;
};

type EmbedEntry = {
  provider: 'youtube' | 'vimeo';
  videoId: string;
  addedAt: string;
};

const MAX_BYTES = 50 * 1024 * 1024;

function mb(bytes: number) {
  return bytes / (1024 * 1024);
}

function fmtMb(bytes: number, digits = 2) {
  return mb(bytes).toFixed(digits);
}

function basename(pathname: string) {
  const i = pathname.lastIndexOf('/');
  return i >= 0 ? pathname.slice(i + 1) : pathname;
}

function isVideoPath(pathname: string) {
  return /\.(mp4|webm|mov|m4v)$/i.test(pathname);
}

export default function AdminVisualsPanel() {
  const [secretInput, setSecretInput] = useState('');
  const [sessionSecret, setSessionSecret] = useState<string | null>(null);
  const [meta, setMeta] = useState<AdminMeta | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [lastUploadReport, setLastUploadReport] = useState<{ ok: number; errors: string[] } | null>(null);
  const [galleryItems, setGalleryItems] = useState<GalleryItem[]>([]);
  const [galleryLoading, setGalleryLoading] = useState(false);
  const [deletingPathname, setDeletingPathname] = useState<string | null>(null);
  const [embedEntries, setEmbedEntries] = useState<EmbedEntry[]>([]);
  const [embedUrlInput, setEmbedUrlInput] = useState('');
  const [embedBusy, setEmbedBusy] = useState(false);
  const [embedRemovingKey, setEmbedRemovingKey] = useState<string | null>(null);

  const unlocked = sessionSecret !== null && meta !== null;

  const pendingBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  const quotaBytes = meta ? meta.quotaMB * 1024 * 1024 : 0;
  const usedPct = meta && quotaBytes > 0 ? Math.min(100, (meta.usedBytes / quotaBytes) * 100) : 0;
  const afterUploadPct =
    meta && quotaBytes > 0 ? Math.min(100, ((meta.usedBytes + pendingBytes) / quotaBytes) * 100) : 0;
  const overQuota = meta ? meta.usedBytes + pendingBytes > quotaBytes : false;

  const fetchGallery = useCallback(async (secret: string) => {
    setGalleryLoading(true);
    try {
      const res = await fetch('/api/visuals-adminlist', {
        headers: { Authorization: `Bearer ${secret}` },
      });
      const data = (await res.json().catch(() => null)) as { items?: GalleryItem[]; error?: string } | null;
      if (res.ok && data?.items && Array.isArray(data.items)) {
        setGalleryItems(data.items);
      } else {
        setGalleryItems([]);
      }
    } finally {
      setGalleryLoading(false);
    }
  }, []);

  const fetchEmbedList = useCallback(async (secret: string) => {
    const res = await fetch('/api/visuals-youtube', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = (await res.json().catch(() => null)) as { entries?: EmbedEntry[] } | null;
    if (res.ok && data?.entries && Array.isArray(data.entries)) {
      setEmbedEntries(
        data.entries.map((e) => ({
          provider: e.provider === 'vimeo' ? 'vimeo' : 'youtube',
          videoId: e.videoId,
          addedAt: e.addedAt,
        })),
      );
    } else {
      setEmbedEntries([]);
    }
  }, []);

  useEffect(() => {
    if (!sessionSecret) {
      setGalleryItems([]);
      setEmbedEntries([]);
      setEmbedUrlInput('');
      return;
    }
    void fetchGallery(sessionSecret);
    void fetchEmbedList(sessionSecret);
  }, [sessionSecret, fetchGallery, fetchEmbedList]);

  const onDrop = useCallback((accepted: File[]) => {
    setFiles((prev) => [...prev, ...accepted]);
  }, []);

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const first = rejections[0];
    if (!first) return;
    const code = first.errors[0]?.code;
    const msg =
      code === 'file-too-large'
        ? 'Algún archivo supera el límite de 50 MB.'
        : 'Algunos archivos no son imágenes o vídeos válidos.';
    toast.warning('No se añadieron archivos', { description: msg });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: { 'image/*': [], 'video/*': [] },
    maxSize: MAX_BYTES,
    disabled: !unlocked,
    multiple: true,
  });

  const verify = useCallback(async () => {
    const s = secretInput.trim();
    setVerifyError(null);
    if (!s) {
      setVerifyError('Escribe la palabra secreta.');
      return;
    }
    setVerifying(true);
    try {
      const res = await fetch('/api/visuals-adminmeta', {
        headers: { Authorization: `Bearer ${s}` },
      });
      const raw = await res.text();
      let data: AdminMeta & { error?: string } = {} as AdminMeta & { error?: string };
      try {
        data = JSON.parse(raw) as AdminMeta & { error?: string };
      } catch {
        setVerifyError(`Respuesta inválida (${res.status})`);
        setVerifying(false);
        return;
      }
      if (!res.ok) {
        setVerifyError(data.error ?? `Error ${res.status}`);
        setVerifying(false);
        return;
      }
      setSessionSecret(s);
      setMeta({
        usedBytes: data.usedBytes ?? 0,
        mediaFileCount: data.mediaFileCount ?? 0,
        quotaMB: data.quotaMB ?? 500,
      });
      setLastUploadReport(null);
      setFiles([]);
    } catch (e) {
      setVerifyError(e instanceof Error ? e.message : 'No se pudo verificar');
    } finally {
      setVerifying(false);
    }
  }, [secretInput]);

  const refreshMeta = useCallback(async (secret: string) => {
    const res = await fetch('/api/visuals-adminmeta', {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = (await res.json().catch(() => null)) as AdminMeta | null;
    if (res.ok && data && typeof data.usedBytes === 'number') {
      setMeta({
        usedBytes: data.usedBytes,
        mediaFileCount: data.mediaFileCount ?? 0,
        quotaMB: data.quotaMB ?? 500,
      });
    }
  }, []);

  const upload = useCallback(async () => {
    if (!sessionSecret || !files.length) return;
    const batch = [...files];
    let okCount = 0;
    let okBytes = 0;
    const errors: string[] = [];

    setUploading(true);
    setLastUploadReport(null);
    try {
      for (const file of batch) {
        const fd = new FormData();
        fd.append('file', file);
        try {
          const res = await fetch('/api/visuals-upload', {
            method: 'POST',
            headers: { Authorization: `Bearer ${sessionSecret}` },
            body: fd,
          });
          const raw = await res.text();
          let data: { url?: string; error?: string; hint?: string } = {};
          try {
            data = JSON.parse(raw) as { url?: string; error?: string; hint?: string };
          } catch {
            errors.push(`${file.name}: respuesta no válida (${res.status})`);
            continue;
          }
          if (!res.ok) {
            const detail = data.hint ? `${data.error ?? res.statusText} — ${data.hint}` : (data.error ?? res.statusText);
            errors.push(`${file.name}: ${detail}`);
            continue;
          }
          okCount += 1;
          okBytes += file.size;
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : 'fallo de red'}`);
        }
      }

      await refreshMeta(sessionSecret);
      await fetchGallery(sessionSecret);

      setFiles([]);
      setLastUploadReport({ ok: okCount, errors });

      if (okCount > 0) {
        toast.success('Subida completada', {
          description: `${okCount} ${okCount === 1 ? 'archivo' : 'archivos'} · ${fmtMb(okBytes, 2)} MB`,
        });
      }
      if (errors.length > 0) {
        if (okCount === 0) {
          toast.error('No se subió ningún archivo', {
            description: errors.slice(0, 3).join(' · '),
            duration: 10000,
          });
        } else {
          toast.warning('Algunos archivos fallaron', {
            description: `${errors.length} error(es). Revisa el resumen abajo.`,
            duration: 8000,
          });
        }
      }
    } finally {
      setUploading(false);
    }
  }, [files, fetchGallery, refreshMeta, sessionSecret]);

  const runDeleteBlob = useCallback(
    async (pathname: string) => {
      if (!sessionSecret) return;
      setDeletingPathname(pathname);
      try {
        await toast.promise(
          (async () => {
            const res = await fetch('/api/visuals-delete', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${sessionSecret}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ pathname }),
            });
            const data = (await res.json().catch(() => null)) as { error?: string } | null;
            if (!res.ok) {
              throw new Error(data?.error ?? `Error ${res.status}`);
            }
            await refreshMeta(sessionSecret);
            await fetchGallery(sessionSecret);
          })(),
          {
            loading: 'Eliminando…',
            success: 'Archivo eliminado del almacenamiento',
            error: (err) => (err instanceof Error ? err.message : 'No se pudo eliminar'),
          },
        );
      } finally {
        setDeletingPathname(null);
      }
    },
    [fetchGallery, refreshMeta, sessionSecret],
  );

  const requestDeleteBlob = useCallback(
    (pathname: string) => {
      const name = basename(pathname);
      toast(`¿Eliminar “${name}”?`, {
        description: 'Se borrará de Vercel Blob. Esta acción no se puede deshacer.',
        duration: 20000,
        action: {
          label: 'Sí, eliminar',
          onClick: (e) => {
            e.preventDefault();
            void runDeleteBlob(pathname);
          },
        },
        cancel: {
          label: 'Cancelar',
          onClick: () => {},
        },
      });
    },
    [runDeleteBlob],
  );

  const addEmbedLink = useCallback(async () => {
    if (!sessionSecret) return;
    const url = embedUrlInput.trim();
    if (!url) {
      toast.info('Pega un enlace', {
        description: 'YouTube (watch, youtu.be, Shorts…) o Vimeo (vimeo.com/…).',
      });
      return;
    }
    setEmbedBusy(true);
    try {
      await toast.promise(
        (async () => {
          const res = await fetch('/api/visuals-youtube', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${sessionSecret}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ action: 'add', url }),
          });
          const data = (await res.json().catch(() => null)) as { error?: string; entries?: EmbedEntry[] } | null;
          if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
          if (data?.entries) {
            setEmbedEntries(
              data.entries.map((e) => ({
                provider: e.provider === 'vimeo' ? 'vimeo' : 'youtube',
                videoId: e.videoId,
                addedAt: e.addedAt,
              })),
            );
          }
          setEmbedUrlInput('');
        })(),
        {
          loading: 'Guardando enlace…',
          success: 'Enlace añadido a la galería',
          error: (err) => (err instanceof Error ? err.message : 'No se pudo añadir'),
        },
      );
    } finally {
      setEmbedBusy(false);
    }
  }, [sessionSecret, embedUrlInput]);

  const runRemoveEmbed = useCallback(
    async (provider: EmbedEntry['provider'], videoId: string) => {
      if (!sessionSecret) return;
      const rk = `${provider}:${videoId}`;
      setEmbedRemovingKey(rk);
      try {
        await toast.promise(
          (async () => {
            const res = await fetch('/api/visuals-youtube', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${sessionSecret}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ action: 'remove', provider, videoId }),
            });
            const data = (await res.json().catch(() => null)) as { error?: string; entries?: EmbedEntry[] } | null;
            if (!res.ok) throw new Error(data?.error ?? `Error ${res.status}`);
            if (data?.entries) {
              setEmbedEntries(
                data.entries.map((e) => ({
                  provider: e.provider === 'vimeo' ? 'vimeo' : 'youtube',
                  videoId: e.videoId,
                  addedAt: e.addedAt,
                })),
              );
            }
          })(),
          {
            loading: 'Quitando vídeo…',
            success: 'Enlace eliminado',
            error: (err) => (err instanceof Error ? err.message : 'No se pudo quitar'),
          },
        );
      } finally {
        setEmbedRemovingKey(null);
      }
    },
    [sessionSecret],
  );

  const requestRemoveEmbed = useCallback(
    (provider: EmbedEntry['provider'], videoId: string) => {
      const label = provider === 'vimeo' ? 'Vimeo' : 'YouTube';
      toast('¿Quitar este vídeo de la galería?', {
        description: `${label} · ${videoId}`,
        duration: 20000,
        action: {
          label: 'Sí, quitar',
          onClick: (e) => {
            e.preventDefault();
            void runRemoveEmbed(provider, videoId);
          },
        },
        cancel: {
          label: 'Cancelar',
          onClick: () => {},
        },
      });
    },
    [runRemoveEmbed],
  );

  const lockSession = () => {
    setSessionSecret(null);
    setMeta(null);
    setFiles([]);
    setLastUploadReport(null);
    setGalleryItems([]);
    setEmbedEntries([]);
    setEmbedUrlInput('');
    setVerifyError(null);
  };

  return (
    <>
      <Toaster
        theme="dark"
        richColors
        closeButton
        position="bottom-center"
        offset="5.5rem"
        toastOptions={{
          duration: 5000,
          classNames: {
            toast: '!bg-zinc-900 !border-white/15 !text-white',
            description: '!text-white/70',
            cancelButton: '!bg-white/10 !text-white !border-white/20',
            actionButton: '!bg-red-600 !text-white !border-red-500',
          },
        }}
      />
      <div className="mx-auto w-full max-w-xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white">Visuals upload</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-white/65">
          Los archivos van a Vercel Blob bajo <span className="text-white/90">visuals/</span>. También puedes enlazar
          vídeos de YouTube o Vimeo (manifiesto en Blob). Verifica la clave y gestiona todo aquí.
        </p>
      </div>

      <section className="rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-sm">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-white/50">
            Paso 1 · Palabra mágica
          </h2>
          {unlocked ? (
            <button
              type="button"
              onClick={lockSession}
              className="shrink-0 rounded-full border border-white/20 px-3 py-1 text-[12px] font-medium text-white/75 transition hover:border-white/35 hover:text-white"
            >
              Cerrar sesión
            </button>
          ) : null}
        </div>

        <label className="mt-4 block text-[13px] font-medium text-white/75">
          Clave (misma que <code className="text-white/90">VISUALS_UPLOAD_SECRET</code>)
          <input
            type="password"
            autoComplete="off"
            value={secretInput}
            disabled={unlocked}
            onChange={(e) => setSecretInput(e.target.value)}
            className="mt-2 w-full rounded-xl border border-white/12 bg-black/40 px-4 py-3 text-[15px] text-white outline-none ring-white/20 placeholder:text-white/25 focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50"
            placeholder="Tu secreto…"
          />
        </label>

        {verifyError ? (
          <p className="mt-3 rounded-lg border border-white/25 bg-white/[0.06] px-3 py-2 text-[13px] text-white/85">
            {verifyError}
          </p>
        ) : null}

        {!unlocked ? (
          <button
            type="button"
            onClick={() => void verify()}
            disabled={verifying}
            className="mt-5 w-full rounded-full border-2 border-white bg-white py-3 text-[14px] font-semibold text-neutral-900 transition-all duration-200 ease-out hover:border-white hover:bg-zinc-100 hover:text-neutral-950 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.35),0_14px_42px_rgba(0,0,0,0.35)] active:scale-[0.99] disabled:opacity-50 disabled:hover:bg-white disabled:hover:shadow-none"
          >
            {verifying ? 'Verificando…' : 'Verificar y continuar'}
          </button>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-white/75">
            <span className="inline-flex h-2 w-2 rounded-full bg-white" />
            Sesión verificada · puedes subir y borrar archivos
          </p>
        )}
      </section>

      <section
        className={`rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition ${
          unlocked ? 'opacity-100' : 'pointer-events-none opacity-35'
        }`}
        aria-hidden={!unlocked}
      >
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-white/50">
          Paso 2 · Almacenamiento y subida
        </h2>

        {meta ? (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-2 text-[13px] text-white/70">
              <div>
                <span className="text-white/90">{fmtMb(meta.usedBytes)} MB</span> usados
                <span className="mx-1.5 text-white/35">·</span>
                <span className="text-white/90">{meta.mediaFileCount}</span> archivos en galería
              </div>
              <div className="text-right">
                <span className="text-white/50">Tope configurado</span>{' '}
                <span className="font-semibold text-white/90">{meta.quotaMB} MB</span>
              </div>
            </div>

            <div className="relative h-3 overflow-hidden rounded-full bg-white/10">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/45 transition-[width] duration-500"
                style={{ width: `${usedPct}%` }}
              />
              {pendingBytes > 0 ? (
                <div
                  className={`absolute inset-y-0 rounded-full transition-[width] duration-500 ${
                    overQuota ? 'bg-white/20' : 'bg-white/28'
                  }`}
                  style={{
                    left: `${usedPct}%`,
                    width: `${Math.max(0, afterUploadPct - usedPct)}%`,
                  }}
                />
              ) : null}
            </div>

            <p className="text-[12px] leading-relaxed text-white/45">
              Tope <code className="text-white/60">VISUALS_QUOTA_MB</code> (por defecto 500 MB) solo para la barra. Uso
              real: blobs bajo <code className="text-white/60">visuals/</code>.
            </p>

            {pendingBytes > 0 ? (
              <p className={`text-[13px] font-medium ${overQuota ? 'text-white/90' : 'text-white/80'}`}>
                Cola actual: <span className="text-white">{fmtMb(pendingBytes)} MB</span>
                {overQuota ? (
                  <span className="block pt-1 text-white/55">
                    Supera el tope mostrado; en Vercel puede fallar si excedes el plan real.
                  </span>
                ) : null}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-white/40">Verifica la clave para ver el uso.</p>
        )}

        <div className="mt-8">
          <p className="text-[13px] font-medium text-white/75">Imágenes o vídeos</p>
          <div
            {...getRootProps()}
            className={`mt-2 flex min-h-[140px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-8 text-center transition ${
              !unlocked
                ? 'cursor-not-allowed border-white/10 bg-black/20 opacity-50'
                : isDragActive
                  ? 'border-white/50 bg-white/[0.08]'
                  : 'border-white/20 bg-black/25 hover:border-white/35 hover:bg-white/[0.05]'
            }`}
          >
            <input {...getInputProps()} />
            <span className="text-[14px] font-medium text-white/85">
              {isDragActive ? 'Suelta para añadir…' : 'Arrastra archivos aquí o haz clic para elegir'}
            </span>
            <span className="max-w-sm text-[12px] text-white/45">
              Imágenes y vídeos · varios a la vez · máximo 50 MB por archivo
            </span>
          </div>
        </div>

        {files.length > 0 ? (
          <ul className="mt-4 space-y-2">
            {files.map((file) => (
              <li
                key={`${file.name}-${file.size}-${file.lastModified}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-[13px]"
              >
                <span className="min-w-0 flex-1 truncate text-white/85">{file.name}</span>
                <span className="shrink-0 text-white/45">{fmtMb(file.size, 1)} MB</span>
                <button
                  type="button"
                  onClick={() => setFiles((f) => f.filter((x) => x !== file))}
                  disabled={uploading}
                  className="shrink-0 rounded-lg border border-white/15 px-2 py-1 text-[12px] font-medium text-white/70 transition hover:border-white/30 hover:text-white disabled:opacity-40"
                >
                  Quitar
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <button
          type="button"
          onClick={() => void upload()}
          disabled={!unlocked || !files.length || uploading}
          className="mt-6 w-full rounded-full border border-white/25 bg-white py-3.5 text-[14px] font-semibold text-neutral-900 transition-all duration-200 ease-out hover:border-white/50 hover:bg-zinc-100 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.2),0_12px_36px_rgba(0,0,0,0.3)] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-45 disabled:hover:bg-white disabled:hover:shadow-none"
        >
          {uploading ? 'Subiendo…' : 'Subir ahora'}
        </button>

        {uploading ? (
          <p className="mt-3 text-center text-[13px] text-white/55">No cierres la pestaña hasta que termine.</p>
        ) : null}

        {lastUploadReport ? (
          <div className="mt-4 rounded-xl border border-white/10 bg-black/40 px-4 py-3 text-[13px] text-white/75">
            {lastUploadReport.ok > 0 ? (
              <p className="font-medium text-white/90">
                Correctos: {lastUploadReport.ok}{' '}
                {lastUploadReport.ok === 1 ? 'archivo' : 'archivos'}
              </p>
            ) : (
              <p className="font-medium text-white/90">Ningún archivo se subió correctamente.</p>
            )}
            {lastUploadReport.errors.length > 0 ? (
              <ul className="mt-2 max-h-40 list-disc space-y-1 overflow-y-auto pl-4 text-[12px] text-red-200/90">
                {lastUploadReport.errors.map((line, idx) => (
                  <li key={`${idx}:${line}`}>{line}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[12px] text-white/45">La galería pública se actualiza al recargar /visuals.</p>
          </div>
        ) : null}
      </section>

      <section
        className={`rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition ${
          unlocked ? 'opacity-100' : 'pointer-events-none opacity-35'
        }`}
        aria-hidden={!unlocked}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-white/50">
            Paso 3 · Archivos en Blob
          </h2>
          {unlocked && sessionSecret ? (
            <button
              type="button"
              onClick={() => void fetchGallery(sessionSecret)}
              disabled={galleryLoading}
              className="rounded-full border border-white/20 px-3 py-1.5 text-[12px] font-medium text-white/75 transition hover:border-white/35 hover:text-white disabled:opacity-40"
            >
              {galleryLoading ? 'Actualizando…' : 'Actualizar lista'}
            </button>
          ) : null}
        </div>

        {galleryLoading && galleryItems.length === 0 ? (
          <p className="mt-6 text-[13px] text-white/50">Cargando miniaturas…</p>
        ) : null}

        {!galleryLoading && galleryItems.length === 0 && unlocked ? (
          <p className="mt-6 text-[13px] text-white/45">Aún no hay archivos en la galería de Blob.</p>
        ) : null}

        {galleryItems.length > 0 ? (
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {galleryItems.map((item) => {
              const vid = isVideoPath(item.pathname);
              const busy = deletingPathname === item.pathname;
              return (
                <div
                  key={item.pathname}
                  className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/50 shadow-inner"
                >
                  <div className="aspect-square bg-black/40">
                    {vid ? (
                      <video
                        src={item.url}
                        className="h-full w-full object-cover"
                        muted
                        playsInline
                        preload="metadata"
                      />
                    ) : (
                      <img src={item.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/80 to-transparent px-2 pb-2 pt-10">
                    <p className="truncate text-[10px] font-medium text-white/70" title={item.pathname}>
                      {basename(item.pathname)}
                    </p>
                    <p className="text-[10px] text-white/40">{fmtMb(item.size, 1)} MB</p>
                    <button
                      type="button"
                      onClick={() => requestDeleteBlob(item.pathname)}
                      disabled={busy || !!deletingPathname}
                      className="mt-1.5 w-full rounded-lg border border-red-400/35 bg-red-950/40 py-1.5 text-[11px] font-semibold text-red-100 transition hover:border-red-300/50 hover:bg-red-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {busy ? 'Eliminando…' : 'Eliminar'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section
        className={`rounded-2xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm transition ${
          unlocked ? 'opacity-100' : 'pointer-events-none opacity-35'
        }`}
        aria-hidden={!unlocked}
      >
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.12em] text-white/50">
          Paso 4 · YouTube / Vimeo (enlaces)
        </h2>
        <p className="mt-3 text-[13px] leading-relaxed text-white/55">
          Pega la URL (YouTube: watch, <code className="text-white/70">youtu.be</code>, Shorts; Vimeo:{' '}
          <code className="text-white/70">vimeo.com/…</code> o id numérico). Aparecerá en{' '}
          <span className="text-white/80">/visuals</span> mezclado con el resto por fecha de alta.
        </p>

        <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1 text-[13px] font-medium text-white/75">
            Enlace o id del vídeo
            <input
              type="url"
              inputMode="url"
              autoComplete="off"
              value={embedUrlInput}
              disabled={!unlocked || embedBusy}
              onChange={(e) => setEmbedUrlInput(e.target.value)}
              placeholder="YouTube o https://vimeo.com/…"
              className="mt-2 w-full rounded-xl border border-white/12 bg-black/40 px-4 py-3 text-[14px] text-white outline-none ring-white/20 placeholder:text-white/25 focus:ring-2 disabled:opacity-45"
            />
          </label>
          <button
            type="button"
            onClick={() => void addEmbedLink()}
            disabled={!unlocked || embedBusy || !embedUrlInput.trim()}
            className="shrink-0 rounded-full border border-white/25 bg-white px-6 py-3 text-[14px] font-semibold text-neutral-900 transition hover:border-white/50 hover:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {embedBusy ? 'Guardando…' : 'Añadir a la galería'}
          </button>
        </div>

        {embedEntries.length > 0 ? (
          <ul className="mt-6 space-y-2">
            {embedEntries.map((row) => {
              const rk = `${row.provider}:${row.videoId}`;
              const busy = embedRemovingKey === rk;
              const openHref =
                row.provider === 'vimeo'
                  ? `https://vimeo.com/${encodeURIComponent(row.videoId)}`
                  : `https://www.youtube.com/watch?v=${encodeURIComponent(row.videoId)}`;
              return (
                <li
                  key={rk}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/35 px-3 py-2.5 text-[13px]"
                >
                  <div className="min-w-0">
                    <span className="inline-block rounded border border-white/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white/60">
                      {row.provider}
                    </span>
                    <span className="ml-2 font-mono text-[12px] text-white/85">{row.videoId}</span>
                    <span className="mt-0.5 block text-[11px] text-white/40">
                      Añadido {new Date(row.addedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <a
                      href={openHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-lg border border-white/15 px-2 py-1 text-[12px] font-medium text-white/75 hover:border-white/30 hover:text-white"
                    >
                      Abrir
                    </a>
                    <button
                      type="button"
                      onClick={() => requestRemoveEmbed(row.provider, row.videoId)}
                      disabled={busy || !!embedRemovingKey}
                      className="rounded-lg border border-red-400/35 bg-red-950/30 px-2 py-1 text-[12px] font-semibold text-red-100 hover:bg-red-900/40 disabled:opacity-45"
                    >
                      {busy ? '…' : 'Quitar'}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : unlocked ? (
          <p className="mt-5 text-[13px] text-white/40">Aún no hay enlaces de YouTube ni Vimeo.</p>
        ) : null}
      </section>

      </div>
    </>
  );
}
