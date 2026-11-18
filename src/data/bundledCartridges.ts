import type { BookCartridge } from '../types/cartridge.types';
import { validateBookCartridge } from '../types/cartridge.schema';

const BUNDLED_CARTRIDGE_URLS = [
  '/cartridges/practical-programming/cartridge.json',
  '/cartridges/intuitive-python/cartridge.json',
];

export async function loadBundledCartridges(): Promise<BookCartridge[]> {
  const results: BookCartridge[] = [];

  for (const url of BUNDLED_CARTRIDGE_URLS) {
    try {
      const response = await fetch(url);
      if (!response.ok) continue;
      const raw = (await response.json()) as unknown;
      const validation = validateBookCartridge(raw);
      if (validation.success) {
        results.push(validation.cartridge);
      } else {
        console.warn(`Cartucho invalido en ${url}:`, validation.issues);
      }
    } catch (err) {
      console.warn(`No se pudo cargar el cartucho ${url}:`, err);
    }
  }

  return results;
}
