import { useEffect, useState } from 'react';

export interface OpenRouterModelOption {
  id: string;
  label: string;
  vendor: string;
  contextK: number;
  recommended?: boolean;
}

const MODELS_ENDPOINT = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY = 'living_books_openrouter_models_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Curated fallback used when the OpenRouter API is unreachable (offline).
 * Includes DeepSeek and other popular structured-output models.
 */
export const FALLBACK_OPENROUTER_MODELS: OpenRouterModelOption[] = [
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek', contextK: 128, recommended: true },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek Chat (V3)', vendor: 'DeepSeek', contextK: 64, recommended: true },
  { id: 'deepseek/deepseek-r1', label: 'DeepSeek R1', vendor: 'DeepSeek', contextK: 64 },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', vendor: 'Google', contextK: 1000, recommended: true },
  { id: 'google/gemini-flash-1.5', label: 'Gemini Flash 1.5', vendor: 'Google', contextK: 1000 },
  { id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', vendor: 'Anthropic', contextK: 200, recommended: true },
  { id: 'anthropic/claude-3.5-haiku', label: 'Claude 3.5 Haiku', vendor: 'Anthropic', contextK: 200 },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', vendor: 'OpenAI', contextK: 128, recommended: true },
  { id: 'openai/gpt-4o', label: 'GPT-4o', vendor: 'OpenAI', contextK: 128 },
  { id: 'meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B Instruct', vendor: 'Meta', contextK: 128 },
  { id: 'qwen/qwen-2.5-72b-instruct', label: 'Qwen 2.5 72B Instruct', vendor: 'Qwen', contextK: 128 },
  { id: 'mistralai/mistral-large', label: 'Mistral Large', vendor: 'Mistral', contextK: 128 },
];

/** Backwards-compatible alias. */
export const OPENROUTER_MODELS = FALLBACK_OPENROUTER_MODELS;

export const DEFAULT_OPENROUTER_MODEL = 'deepseek/deepseek-v4.1-flash';

interface RawOpenRouterModel {
  id: string;
  name?: string;
  context_length?: number;
}

function toOption(raw: RawOpenRouterModel): OpenRouterModelOption {
  const [vendorSlug] = raw.id.split('/');
  const vendor = vendorSlug
    ? vendorSlug.charAt(0).toUpperCase() + vendorSlug.slice(1)
    : 'Otro';
  const label = raw.name ? raw.name.replace(/^[^:]+:\s*/, '') : raw.id;
  return {
    id: raw.id,
    label,
    vendor,
    contextK: raw.context_length ? Math.round(raw.context_length / 1000) : 0,
  };
}

interface CachedModels {
  fetchedAt: number;
  models: OpenRouterModelOption[];
}

function readCache(): OpenRouterModelOption[] | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedModels;
    if (Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed.models;
  } catch {
    return null;
  }
}

function writeCache(models: OpenRouterModelOption[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), models }));
  } catch {
    // ignore quota errors
  }
}

/**
 * Fetches the full OpenRouter model catalog (public endpoint, no auth).
 * Falls back to the curated list on failure.
 */
export async function fetchOpenRouterModels(): Promise<OpenRouterModelOption[]> {
  const cached = readCache();
  if (cached && cached.length > 0) return cached;

  try {
    const response = await fetch(MODELS_ENDPOINT);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as { data?: RawOpenRouterModel[] };
    const models = (data.data ?? [])
      .map(toOption)
      .sort((a, b) => a.vendor.localeCompare(b.vendor) || a.label.localeCompare(b.label));
    if (models.length === 0) throw new Error('Lista vacia');
    writeCache(models);
    return models;
  } catch {
    return FALLBACK_OPENROUTER_MODELS;
  }
}

/** React hook that loads the full OpenRouter catalog with a fallback. */
export function useOpenRouterModels(): { models: OpenRouterModelOption[]; loading: boolean } {
  const [models, setModels] = useState<OpenRouterModelOption[]>(readCache() ?? FALLBACK_OPENROUTER_MODELS);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchOpenRouterModels()
      .then((result) => {
        if (!cancelled) setModels(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { models, loading };
}
