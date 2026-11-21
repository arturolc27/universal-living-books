import { usePlatformStore } from '../../store/usePlatformStore';
import { GlobalSrsHub } from '../srs/GlobalSrsHub';

/**
 * Arena de repaso espaciado dentro de un libro: delega en el motor FSRS v4.5
 * acotado al libro activo (o global si no hay libro abierto).
 */
export function Sm2FlashcardArena() {
  const activeBookId = usePlatformStore((s) => s.activeBookId);
  return <GlobalSrsHub scopedBookId={activeBookId ?? undefined} />;
}
