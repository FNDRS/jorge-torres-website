import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

type AdminMeta = {
  usedBytes: number;
  mediaFileCount: number;
  quotaMB: number;
};

function mb(bytes: number) {
  return bytes / (1024 * 1024);
}

function fmtMb(bytes: number, digits = 2) {
  return mb(bytes).toFixed(digits);
}

export default function AdminVisualsPanel() {
  const [secretInput, setSecretInput] = useState('');
  const [sessionSecret, setSessionSecret] = useState<string | null>(null);
  const [meta, setMeta] = useState<AdminMeta | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<{ count: number; bytes: number } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 5500);
    return () => window.clearTimeout(t);
  }, [toast]);

  const unlocked = sessionSecret !== null && meta !== null;

  const pendingBytes = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);

  const quotaBytes = meta ? meta.quotaMB * 1024 * 1024 : 0;
  const usedPct = meta && quotaBytes > 0 ? Math.min(100, (meta.usedBytes / quotaBytes) * 100) : 0;
  const afterUploadPct =
    meta && quotaBytes > 0 ? Math.min(100, ((meta.usedBytes + pendingBytes) / quotaBytes) * 100) : 0;
  const overQuota = meta ? meta.usedBytes + pendingBytes > quotaBytes : false;

  const pushLog = useCallback((line: string) => {
    setLogLines((prev) => [...prev, line]);
  }, []);

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
      setLogLines([]);
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

  const onFilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    const list = e.target.files;
    setFiles(list?.length ? Array.from(list) : []);
  };

  const upload = useCallback(async () => {
    if (!sessionSecret || !files.length) return;
    const batch = [...files];
    let okCount = 0;
    let okBytes = 0;

    setUploading(true);
    setLogLines([]);
    try {
      for (const file of batch) {
        const fd = new FormData();
        fd.append('file', file);
        pushLog(`Subiendo ${file.name} (${fmtMb(file.size, 1)} MB)…`);
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
            pushLog(`Error ${res.status}: respuesta no JSON`);
            continue;
          }
          if (!res.ok) {
            pushLog(`Error ${res.status}: ${data.error ?? res.statusText}`);
            if (data.hint) pushLog(data.hint);
            continue;
          }
          okCount += 1;
          okBytes += file.size;
          pushLog(`Listo → ${data.url ?? 'sin URL'}`);
        } catch (err) {
          pushLog(err instanceof Error ? err.message : 'Fallo de red');
        }
      }
      pushLog('Fin. Recarga /visuals para ver la galería desde Blob.');
      await refreshMeta(sessionSecret);

      setFiles([]);
      if (fileInputRef.current) fileInputRef.current.value = '';

      if (okCount > 0) {
        setToast({ count: okCount, bytes: okBytes });
      }
    } finally {
      setUploading(false);
    }
  }, [files, pushLog, refreshMeta, sessionSecret]);

  const lockSession = () => {
    setSessionSecret(null);
    setMeta(null);
    setFiles([]);
    setLogLines([]);
    setVerifyError(null);
  };

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-white">Visuals upload</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-white/65">
          Los archivos van a Vercel Blob bajo <span className="text-white/90">visuals/</span>. Primero verifica la
          clave; después podrás elegir archivos y ver cuánto espacio llevas.
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
            className="mt-5 w-full rounded-full border-2 border-white bg-white py-3 text-[14px] font-semibold text-black transition hover:bg-black hover:text-white disabled:opacity-50"
          >
            {verifying ? 'Verificando…' : 'Verificar y continuar'}
          </button>
        ) : (
          <p className="mt-4 flex items-center gap-2 text-[13px] font-medium text-white/75">
            <span className="inline-flex h-2 w-2 rounded-full bg-white" />
            Sesión verificada · puedes subir archivos
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
          Paso 2 · Almacenamiento
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
              El tope es <code className="text-white/60">VISUALS_QUOTA_MB</code> (por defecto 500 MB) solo para esta
              barra; ajústalo a tu plan en Vercel. El uso real se calcula sumando tus blobs en{' '}
              <code className="text-white/60">visuals/</code>.
            </p>

            {pendingBytes > 0 ? (
              <p className={`text-[13px] font-medium ${overQuota ? 'text-white/90' : 'text-white/80'}`}>
                Esta selección: <span className="text-white">{fmtMb(pendingBytes)} MB</span>
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

        <label className={`mt-8 block text-[13px] font-medium text-white/75 ${!unlocked ? 'cursor-not-allowed' : ''}`}>
          Imágenes o videos
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            disabled={!unlocked}
            onChange={onFilesChange}
            className="mt-2 block w-full cursor-pointer text-[14px] text-white/80 file:mr-4 file:cursor-pointer file:rounded-xl file:border-0 file:bg-white file:px-4 file:py-2.5 file:text-[13px] file:font-semibold file:text-black file:hover:bg-white/90 disabled:opacity-40"
          />
        </label>

        {files.length > 0 ? (
          <p className="mt-2 text-[12px] text-white/45">{files.length} archivo(s) listos.</p>
        ) : null}

        <button
          type="button"
          onClick={() => void upload()}
          disabled={!unlocked || !files.length || uploading}
          className="mt-8 w-full rounded-full bg-white py-3.5 text-[14px] font-semibold text-black/90 transition hover:bg-white/95 disabled:cursor-not-allowed disabled:opacity-45"
        >
          {uploading ? 'Subiendo…' : 'Subir ahora'}
        </button>
      </section>

      {logLines.length > 0 ? (
        <pre className="max-h-64 overflow-auto rounded-2xl border border-white/10 bg-black/50 p-4 font-mono text-[12px] leading-relaxed text-white/80">
          {logLines.join('\n')}
        </pre>
      ) : null}

      {toast ? (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-[60] w-[min(92vw,22rem)] -translate-x-1/2 rounded-2xl border-2 border-white bg-black px-5 py-4 text-center shadow-[0_12px_40px_rgba(0,0,0,0.65)] animate-fade-in"
        >
          <p className="font-display text-[15px] font-semibold text-white">Subida completada</p>
          <p className="mt-1.5 text-[13px] leading-snug text-white/80">
            {toast.count} {toast.count === 1 ? 'archivo' : 'archivos'} · {fmtMb(toast.bytes, 2)} MB
          </p>
        </div>
      ) : null}
    </div>
  );
}
