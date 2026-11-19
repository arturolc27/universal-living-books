import { useEffect, useState } from 'react';
import Lottie from 'lottie-react';
import type { GpuAnimationBlock } from '../../types/cartridge.types';
import { cn } from '../../ui/utils/cn';
import { isSafeAssetUrl } from '../../ui/utils/sanitize';

const ASPECT_CLASS: Record<GpuAnimationBlock['aspectRatio'], string> = {
  '16:9': 'aspect-video',
  '4:3': 'aspect-[4/3]',
  '21:9': 'aspect-[21/9]',
};

export function GpuMediaStage({ block }: { block: GpuAnimationBlock }) {
  const [lottieData, setLottieData] = useState<object | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const safeUrl = isSafeAssetUrl(block.assetUrl) ? block.assetUrl : null;

  useEffect(() => {
    let cancelled = false;
    setLottieData(null);
    setLoadError(null);
    if (!safeUrl) {
      setLoadError('URL de recurso multimedia no permitida.');
      return;
    }
    if (block.format === 'LOTTIE_JSON') {
      fetch(safeUrl)
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
  }, [safeUrl, block.format]);

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="border-b border-subtle px-3 py-2">
        <h3 className="text-sm font-semibold text-primary">{block.title}</h3>
        <p className="text-xs text-muted">{block.caption}</p>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center p-3">
        <div className={cn('w-full max-w-2xl overflow-hidden rounded-lg border border-subtle bg-canvas', ASPECT_CLASS[block.aspectRatio])}>
          {safeUrl && block.format === 'WEBM_ALPHA' && (
            <video
              src={safeUrl}
              autoPlay
              loop={block.loop}
              muted
              playsInline
              className="h-full w-full object-contain"
            />
          )}
          {safeUrl && block.format === 'LOTTIE_JSON' && lottieData && (
            <Lottie animationData={lottieData} loop={block.loop} className="h-full w-full" />
          )}
          {safeUrl && block.format === 'ANIMATED_SVG' && (
            <img src={safeUrl} alt={block.title} className="h-full w-full object-contain" />
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
