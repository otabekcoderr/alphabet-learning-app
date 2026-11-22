export interface AsrHealthConfig {
  shouldPoll: boolean;
  baseUrl: string;
  healthUrl: string;
}

export interface AsrHealthPollingOptions {
  hostname: string;
  configuredAsrUrl?: string;
  intervalMs?: number;
  onStatus: (online: boolean) => void;
  fetchFn?: typeof fetch;
  setIntervalFn?: (cb: () => void, ms: number) => number;
  clearIntervalFn?: (id: number) => void;
}

/** Return true only for local loopback hostnames. */
export function isLocalHostName(hostname: string): boolean {
  const clean = (hostname || '').trim().toLowerCase();
  return (
    clean === 'localhost' ||
    clean === '127.0.0.1' ||
    clean === '::1' ||
    clean === '[::1]'
  );
}

/** Trim whitespace and trailing slashes from an optional ASR base URL. */
export function normalizeAsrBaseUrl(rawUrl: string | undefined | null): string {
  return (rawUrl ?? '').trim().replace(/\/+$/, '');
}

/**
 * Resolve whether background `/api/health` polling should run.
 * On hosted environments (e.g. `*.vercel.app`, `*.netlify.app`) without an explicit
 * `VITE_ASR_URL`, polling is skipped so the app runs cleanly in offline/picture mode
 * with zero 404 console spam.
 */
export function resolveAsrHealthConfig(options: {
  hostname: string;
  configuredAsrUrl?: string;
}): AsrHealthConfig {
  const baseUrl = normalizeAsrBaseUrl(options.configuredAsrUrl);
  if (baseUrl) {
    return {
      shouldPoll: true,
      baseUrl,
      healthUrl: `${baseUrl}/api/health`,
    };
  }
  if (isLocalHostName(options.hostname)) {
    return {
      shouldPoll: true,
      baseUrl: '',
      healthUrl: '/api/health',
    };
  }
  return {
    shouldPoll: false,
    baseUrl: '',
    healthUrl: '',
  };
}

/**
 * Start `/api/health` polling when enabled, automatically clearing the interval
 * if the endpoint returns HTTP 404 so repeated console 404 errors never occur.
 */
export function startAsrHealthPolling(options: AsrHealthPollingOptions): () => void {
  const config = resolveAsrHealthConfig({
    hostname: options.hostname,
    configuredAsrUrl: options.configuredAsrUrl,
  });

  if (!config.shouldPoll) {
    options.onStatus(false);
    return () => {};
  }

  const fetchFn = options.fetchFn ?? fetch;
  const setIntervalFn =
    options.setIntervalFn ??
    ((cb: () => void, ms: number) => globalThis.setInterval(cb, ms) as unknown as number);
  const clearIntervalFn =
    options.clearIntervalFn ??
    ((id: number) => globalThis.clearInterval(id));
  const intervalMs = options.intervalMs ?? 10_000;

  let active = true;
  let stoppedOn404 = false;
  let timer: number | null = null;

  const stopTimer = () => {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };

  const checkHealth = async () => {
    if (!active || stoppedOn404) return;
    try {
      const res = await fetchFn(config.healthUrl);
      if (!active) return;

      if (res.status === 404) {
        stoppedOn404 = true;
        stopTimer();
        options.onStatus(false);
        return;
      }

      if (!res.ok) {
        options.onStatus(false);
        return;
      }

      const data = (await res.json()) as { ok?: boolean };
      if (active) {
        options.onStatus(Boolean(data.ok));
      }
    } catch {
      if (active) {
        options.onStatus(false);
      }
    }
  };

  timer = setIntervalFn(() => {
    void checkHealth();
  }, intervalMs);

  void checkHealth();

  return () => {
    active = false;
    stopTimer();
  };
}
