import { useEffect, useState } from 'react';
import Lottie from 'lottie-react';
import { Youtube, WifiOff, Play, X } from 'lucide-react';
import type { GpuAnimationBlock, YouTubeRefBlock } from '../../types/cartridge.types';
import { cn } from '../../ui/utils/cn';

const ASPECT_CLASS: Record<GpuAnimationBlock['aspectRatio'], string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '21:9': 'aspect-[21/9]',
};

export function GpuMediaStage({ block }: { block: GpuAnimationBlock }) {
  const [lottieData, setLottieData] = useState<object | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (block.format === 'LOTTIE_JSON') {
      fetch(block.assetUrl)
        .then((res) => res.json())
        .then((data) => {
          if (!cancelled) setLottieData(data as object);
        })
        .catch(() => {
          if (!cancelled) setLoadError('No se pudo cargar la animacion Lottie.');
        });
    }
    return () => {
      cancelled = true;
    };
  }, [block.assetUrl, block.format]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
        <p className="text-xs text-muted">{block.caption}</p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div className={cn('w-full max-w-2xl overflow-hidden rounded-lg border border-subtle bg-canvas', ASPECT_CLASS[block.aspectRatio])}>
          {block.format === 'WEBM_ALPHA' && (
            <video
              src={block.assetUrl}
              autoPlay
              loop={block.loop}
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          )}
          {block.format === 'LOTTIE_JSON' && lottieData && (
            <Lottie animationData={lottieData} loop={block.loop} className="h-full w-full" />
          )}
          {block.format === 'ANIMATED_SVG' && (
            <img src={block.assetUrl} alt={block.title} className="h-full w-full object-contain" />
          )}
          {loadError && (
            <div className="flex h-full items-center justify-center p-4 text-center text-xs text-muted">
              {loadError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function YouTubeSosButton({ block }: { block: YouTubeRefBlock }) {
  const [isOnline, setIsOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const on = () => setIsOnline(true);
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  const start = block.timestampStartSec ?? 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-1.5 rounded-md border border-subtle px-2.5 py-1.5 text-[11px] font-medium text-muted hover:text-primary"
      >
        {isOnline ? <Youtube size={13} className="text-danger" /> : <WifiOff size={13} />}
        {block.title}
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-lg border border-subtle bg-surface">
            <div className="flex items-center justify-between border-b border-subtle px-3 py-2">
              <div>
                <p className="text-sm font-semibold text-primary">{block.title}</p>
                <p className="text-[11px] text-muted">{block.channelName}</p>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} className="text-muted hover:text-primary">
                <X size={16} />
              </button>
            </div>
            <div className="p-3">
              <p className="mb-2 text-xs text-muted">{block.contextWhyWatch}</p>
              {isOnline ? (
                <div className="aspect-video w-full overflow-hidden rounded-md">
                  <iframe
                    title={block.title}
                    src={`https://www.youtube.com/embed/${block.videoId}?start=${start}`}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="h-full w-full"
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 rounded-md border border-subtle bg-canvas p-6 text-center">
                  <WifiOff size={20} className="text-muted" />
                  <p className="text-xs text-muted">
                    Sin conexion. Este recurso de YouTube estara disponible cuando recuperes internet.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function GpuMediaPlaceholder({ label }: { label: string }) {
  return (
    <div className="flex h-full items-center justify-center gap-2 p-6 text-center text-xs text-muted">
      <Play size={14} /> {label}
    </div>
  );
}
