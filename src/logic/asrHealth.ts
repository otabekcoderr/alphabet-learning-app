export interface AsrHealthConfig {
  shouldCheck: boolean;
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
 * Resolve how `/api/health` checks should run for the current origin.
 * On local loopback hostnames or when `VITE_ASR_URL` is configured, periodic polling runs.
 * On hosted/production domains (e.g. `*.vercel.app`, `*.netlify.app`, custom domains) without
 * `VITE_ASR_URL`, a single check runs on page load (`shouldCheck: true, shouldPoll: false`)
 * so Vercel serverless `/api/health` works while static builds cleanly enter offline mode.
 */
export function resolveAsrHealthConfig(options: {
  hostname: string;
  configuredAsrUrl?: string;
}): AsrHealthConfig {
  const baseUrl = normalizeAsrBaseUrl(options.configuredAsrUrl);
  if (baseUrl) {
    return {
      shouldCheck: true,
      shouldPoll: true,
      baseUrl,
      healthUrl: `${baseUrl}/api/health`,
    };
  }
  if (isLocalHostName(options.hostname)) {
    return {
      shouldCheck: true,
      shouldPoll: true,
      baseUrl: '',
      healthUrl: '/api/health',
    };
  }
  if ((options.hostname || '').trim()) {
    return {
      shouldCheck: true,
      shouldPoll: false,
      baseUrl: '',
      healthUrl: '/api/health',
    };
  }
  return {
    shouldCheck: false,
    shouldPoll: false,
    baseUrl: '',
    healthUrl: '',
  };
}

/**
 * Check `/api/health` on load (and poll periodically when `shouldPoll` is enabled),
 * automatically stopping if the endpoint returns HTTP 404 or 503 so offline static
 * builds or unconfigured deployments fall back cleanly without console spam.
 */
export function startAsrHealthPolling(options: AsrHealthPollingOptions): () => void {
  const config = resolveAsrHealthConfig({
    hostname: options.hostname,
    configuredAsrUrl: options.configuredAsrUrl,
  });

  if (!config.shouldCheck || !config.healthUrl) {
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
  let stoppedOnUnavailable = false;
  let timer: number | null = null;

  const stopTimer = () => {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };

  const checkHealth = async () => {
    if (!active || stoppedOnUnavailable) return;
    try {
      const res = await fetchFn(config.healthUrl);
      if (!active) return;

      if (res.status === 404 || res.status === 503) {
        stoppedOnUnavailable = true;
        stopTimer();
        options.onStatus(false);
        return;
      }

      if (!res.ok) {
        options.onStatus(false);
        return;
      }

      const data = (await res.json()) as { ok?: boolean } | null;
      if (active) {
        options.onStatus(Boolean(data?.ok));
      }
    } catch {
      if (active) {
        options.onStatus(false);
      }
    }
  };

  if (config.shouldPoll) {
    timer = setIntervalFn(() => {
      void checkHealth();
    }, intervalMs);
  }

  void checkHealth();

  return () => {
    active = false;
    stopTimer();
  };
}
