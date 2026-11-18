import { describe, expect, it } from 'vitest';
import practicalProgramming from '../public/cartridges/practical-programming/cartridge.json';
import intuitivePython from '../public/cartridges/intuitive-python/cartridge.json';
import { validateBookCartridge } from './types/cartridge.schema';
import { computeNextSm2State, createInitialSrsState, buildPrioritizedReviewQueue } from './engine/srs/sm2Scheduler';

describe('Bundled cartridges', () => {
  it('validates practical-programming against the v2.0 schema', () => {
    const result = validateBookCartridge(practicalProgramming);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.diagnostics.chapterCount).toBe(2);
      expect(result.diagnostics.flashcardCount).toBeGreaterThanOrEqual(3);
      expect(result.diagnostics.packages).toEqual([]);
    }
  });

  it('validates intuitive-python against the v2.0 schema', () => {
    const result = validateBookCartridge(intuitivePython);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.diagnostics.packages).toContain('pandas');
      expect(result.diagnostics.packages).toContain('matplotlib');
    }
  });

  it('rejects an invalid cartridge', () => {
    const result = validateBookCartridge({ schemaVersion: '1.0' });
    expect(result.success).toBe(false);
  });
});

describe('SM-2 scheduler', () => {
  it('schedules a first successful review one day out', () => {
    const initial = createInitialSrsState('book', 'card', 0);
    const next = computeNextSm2State(initial, 4, 0);
    expect(next.repetitions).toBe(1);
    expect(next.interval).toBe(1);
    expect(next.nextReviewTimestamp).toBe(24 * 60 * 60 * 1000);
  });

  it('resets repetitions on a lapse', () => {
    const initial = createInitialSrsState('book', 'card', 0);
    const next = computeNextSm2State(initial, 0, 0);
    expect(next.repetitions).toBe(0);
    expect(next.interval).toBe(1);
  });

  it('prioritizes PC-lab failures in the review queue', () => {
    const cartridge = intuitivePython as never;
    const queue = buildPrioritizedReviewQueue(cartridge, {
      'ip-card-mutation': {
        bookId: 'intuitive-python-field-guide',
        cardId: 'ip-card-mutation',
        repetitions: 0,
        interval: 0,
        easeFactor: 2.5,
        nextReviewTimestamp: Date.now() + 10_000_000,
        failedInPcLab: true,
        updatedAt: 0,
      },
    });
    expect(queue[0].card.cardId).toBe('ip-card-mutation');
  });
});
