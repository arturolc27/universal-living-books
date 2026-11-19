import { useEffect, useState } from 'react';
import type { DeviceMode } from '../../types/cartridge.types';

export interface DeviceProfile {
  isMobile: boolean;
  isCoarsePointer: boolean;
  viewportWidth: number;
  deviceMode: DeviceMode;
}

function readDeviceProfile(): DeviceProfile {
  if (typeof window === 'undefined') {
    return {
      isMobile: false,
      isCoarsePointer: false,
      viewportWidth: 1280,
      deviceMode: 'PC',
    };
  }
  const viewportWidth = window.innerWidth;
  const isCoarsePointer =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const isMobile = viewportWidth < 768 || (isCoarsePointer && viewportWidth < 1024);
  return {
    isMobile,
    isCoarsePointer,
    viewportWidth,
    deviceMode: isMobile ? 'MOBILE' : 'PC',
  };
}

export function useDeviceProfile(): DeviceProfile {
  const [profile, setProfile] = useState<DeviceProfile>(readDeviceProfile);

  useEffect(() => {
    const update = () => setProfile(readDeviceProfile());
    window.addEventListener('resize', update);
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    mq?.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('resize', update);
      mq?.removeEventListener?.('change', update);
    };
  }, []);

  return profile;
}
