import { useEffect, useState } from 'react';

/**
 * Production shell for the immutable TikVTV upstream build.
 * The upstream repository is mounted as a git submodule and is never edited.
 * Keep this shell Xclone-owned; never patch vendor/TikVTV.
 */
export default function TikVTVPage() {
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setReady(false);
    setFailed(false);
  }, []);

  return (
    <div className="fixed inset-0 z-[60] bg-black" data-testid="iptv-page">
      {!ready && !failed && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black text-white">
          <div className="text-center">
            <div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
            <p className="text-sm text-white/70">Loading IPTV…</p>
          </div>
        </div>
      )}
      {failed && (
        <div className="absolute inset-0 z-10 grid place-items-center bg-black p-6 text-white">
          <div className="max-w-md text-center">
            <h1 className="text-xl font-semibold">IPTV is unavailable</h1>
            <p className="mt-2 text-sm text-white/60">The embedded IPTV bundle could not be loaded from this Xclone build.</p>
          </div>
        </div>
      )}
      <iframe
        title="Testagram IPTV"
        src="/iptv-app/entry.html"
        className="h-full w-full border-0 bg-black"
        allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
        allowFullScreen
        onLoad={() => setReady(true)}
        onError={() => setFailed(true)}
      />
    </div>
  );
}
