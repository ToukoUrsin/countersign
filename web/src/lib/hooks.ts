import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, onMode, type Me } from '../api';

/** Small data hook: load, optional polling, manual set (for POST responses). */
export function useQuery<T>(fn: () => Promise<T>, deps: unknown[], opts: { pollMs?: (data: T | undefined) => number | false } = {}) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const pollRef = useRef(opts.pollMs);
  pollRef.current = opts.pollMs;
  const gen = useRef(0);

  const load = useCallback(async () => {
    const g = gen.current;
    try {
      const d = await fnRef.current();
      if (g !== gen.current) return;
      setData(d);
      setError(undefined);
    } catch (e) {
      if (g !== gen.current) return;
      setError(e as Error);
    } finally {
      if (g === gen.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    gen.current++;
    setLoading(true);
    setData(undefined);
    setError(undefined);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    const ms = pollRef.current?.(data);
    if (!ms) return;
    const t = setTimeout(() => void load(), ms);
    return () => clearTimeout(t);
  }, [data, load]);

  return { data, error, loading, reload: load, setData };
}

type KeyMap = Record<string, (e: KeyboardEvent) => void>;
let lastKey = { k: '', t: 0 };

const typing = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
};

/**
 * Keyboard map. Keys: 'j', 'Enter', 'Escape', '?', 'mod+k', 'mod+Enter', and two-key sequences 'g i'.
 * Plain keys are ignored while typing in a field or when a dialog is open (unless `always`).
 */
export function useHotkeys(map: KeyMap, opts: { enabled?: boolean; always?: boolean } = {}) {
  const ref = useRef(map);
  ref.current = map;
  const { enabled = true, always = false } = opts;
  useEffect(() => {
    if (!enabled) return;
    const h = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (mod) {
        const fn = ref.current[`mod+${key}`];
        if (fn) {
          e.preventDefault();
          fn(e);
        }
        return;
      }
      if (e.altKey) return;
      if (typing(e) && key !== 'Escape') return;
      if (!always && key !== 'Escape' && document.querySelector('[data-modal]')) return;
      const now = Date.now();
      const seq = now - lastKey.t < 900 ? `${lastKey.k} ${key}` : '';
      const fn = (seq && ref.current[seq]) || ref.current[e.key] || ref.current[key];
      if (fn) {
        e.preventDefault();
        fn(e);
        lastKey = { k: '', t: 0 };
      } else lastKey = { k: key, t: now };
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [enabled, always]);
}

type Theme = 'dark' | 'light';
const themeListeners = new Set<() => void>();
const getTheme = (): Theme => (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem('cs-theme', t);
  } catch {
    /* private mode */
  }
  themeListeners.forEach((l) => l());
}
export function useTheme(): [Theme, () => void] {
  const theme = useSyncExternalStore(
    (l) => {
      themeListeners.add(l);
      return () => themeListeners.delete(l);
    },
    getTheme,
    () => 'dark' as Theme,
  );
  return [theme, () => setTheme(theme === 'dark' ? 'light' : 'dark')];
}

let mePromise: Promise<Me> | undefined;
export function useMe() {
  const [me, setMe] = useState<Me>();
  useEffect(() => {
    (mePromise ??= api.me()).then(setMe).catch(() => (mePromise = undefined));
  }, []);
  return me;
}

export function useMock() {
  const [mock, setMock] = useState(false);
  useEffect(() => onMode((m) => setMock(m === 'mock')), []);
  return mock;
}

/** Persisted per-key state (localStorage), for things the server does not store until sign-off. */
export function useStored<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const s = localStorage.getItem(key);
      return s ? (JSON.parse(s) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (nv: T | ((p: T) => T)) =>
      setV((p) => {
        const next = typeof nv === 'function' ? (nv as (p: T) => T)(p) : nv;
        try {
          localStorage.setItem(key, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      }),
    [key],
  );
  return [v, set];
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
