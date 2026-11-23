import { describe, expect, it, vi } from 'vitest';
import { resolveAsrHealthConfig, startAsrHealthPolling } from '../asrHealth';

describe('ASR health check & polling guard (Vercel/Netlify/local)', () => {
  it('enables single check without polling on hosted/production origins without VITE_ASR_URL, and enables polling when configured or local', () => {
    expect(
      resolveAsrHealthConfig({
        hostname: 'alifbo-eight.vercel.app',
      }),
    ).toEqual({
      shouldCheck: true,
      shouldPoll: false,
      baseUrl: '',
      healthUrl: '/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: 'my-app.netlify.app',
        configuredAsrUrl: '   ',
      }),
    ).toEqual({
      shouldCheck: true,
      shouldPoll: false,
      baseUrl: '',
      healthUrl: '/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: 'alifbo.uz',
      }),
    ).toEqual({
      shouldCheck: true,
      shouldPoll: false,
      baseUrl: '',
      healthUrl: '/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: '',
      }),
    ).toEqual({
      shouldCheck: false,
      shouldPoll: false,
      baseUrl: '',
      healthUrl: '',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: 'alifbo-eight.vercel.app',
        configuredAsrUrl: 'https://asr.alifbo.uz/',
      }),
    ).toEqual({
      shouldCheck: true,
      shouldPoll: true,
      baseUrl: 'https://asr.alifbo.uz',
      healthUrl: 'https://asr.alifbo.uz/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: 'localhost',
      }),
    ).toEqual({
      shouldCheck: true,
      shouldPoll: true,
      baseUrl: '',
      healthUrl: '/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: '127.0.0.1',
      }),
    ).toEqual({
      shouldCheck: true,
      shouldPoll: true,
      baseUrl: '',
      healthUrl: '/api/health',
    });
  });

  it('performs a single /api/health check without polling on Vercel and sets online=true on 200 OK', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;
    const setIntervalMock = vi.fn<() => number>(() => 1);
    const clearIntervalMock = vi.fn<(id: number) => void>();
    const onStatus = vi.fn<(online: boolean) => void>();

    const cleanup = startAsrHealthPolling({
      hostname: 'alifbo-eight.vercel.app',
      onStatus,
      fetchFn: fetchMock,
      setIntervalFn: setIntervalMock,
      clearIntervalFn: clearIntervalMock,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/health');
    expect(setIntervalMock).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(true);
    cleanup();
  });

  it('falls back cleanly to offline mode after a single check on 404 (Netlify static) or 503 (unconfigured production)', async () => {
    for (const [hostname, status] of [
      ['my-app.netlify.app', 404],
      ['alifbo-eight.vercel.app', 503],
    ] as const) {
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({ ok: false }),
      })) as unknown as typeof fetch;
      const setIntervalMock = vi.fn<() => number>(() => 1);
      const clearIntervalMock = vi.fn<(id: number) => void>();
      const onStatus = vi.fn<(online: boolean) => void>();

      const cleanup = startAsrHealthPolling({
        hostname,
        onStatus,
        fetchFn: fetchMock,
        setIntervalFn: setIntervalMock,
        clearIntervalFn: clearIntervalMock,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('/api/health');
      expect(setIntervalMock).not.toHaveBeenCalled();
      expect(onStatus).toHaveBeenCalledWith(false);
      cleanup();
    }
  });

  it('immediately clears polling interval on first HTTP 404 or 503 without spamming subsequent checks', async () => {
    for (const status of [404, 503] as const) {
      const ticks: Array<() => void> = [];
      const fetchMock = vi.fn(async () => ({
        ok: false,
        status,
        json: async () => ({}),
      })) as unknown as typeof fetch;

      const setIntervalMock = vi.fn((cb: () => void) => {
        ticks.push(cb);
        return 77;
      });
      const clearIntervalMock = vi.fn<(id: number) => void>();
      const onStatus = vi.fn<(online: boolean) => void>();

      const cleanup = startAsrHealthPolling({
        hostname: 'localhost',
        onStatus,
        fetchFn: fetchMock,
        setIntervalFn: setIntervalMock,
        clearIntervalFn: clearIntervalMock,
      });

      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(clearIntervalMock).toHaveBeenCalledWith(77);
      expect(onStatus).toHaveBeenCalledWith(false);

      // Even if a stray tick fires, stoppedOnUnavailable prevents any further /api/health calls
      ticks[0]?.();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      cleanup();
    }
  });

  it('reports online=true when /api/health responds with HTTP 200 and ok: true and keeps polling locally', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })) as unknown as typeof fetch;

    const setIntervalMock = vi.fn(() => 99);
    const clearIntervalMock = vi.fn<(id: number) => void>();
    const onStatus = vi.fn<(online: boolean) => void>();

    const cleanup = startAsrHealthPolling({
      hostname: 'localhost',
      onStatus,
      fetchFn: fetchMock,
      setIntervalFn: setIntervalMock,
      clearIntervalFn: clearIntervalMock,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).toHaveBeenCalledWith('/api/health');
    expect(onStatus).toHaveBeenCalledWith(true);
    expect(clearIntervalMock).not.toHaveBeenCalled();

    cleanup();
    expect(clearIntervalMock).toHaveBeenCalledWith(99);
  });

  it('performs zero fetches and zero intervals when hostname is empty', () => {
    const fetchMock = vi.fn<typeof fetch>();
    const setIntervalMock = vi.fn<() => number>(() => 1);
    const clearIntervalMock = vi.fn<(id: number) => void>();
    const onStatus = vi.fn<(online: boolean) => void>();

    const cleanup = startAsrHealthPolling({
      hostname: '',
      onStatus,
      fetchFn: fetchMock,
      setIntervalFn: setIntervalMock,
      clearIntervalFn: clearIntervalMock,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(false);
    cleanup();
  });
});
