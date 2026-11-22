import { describe, expect, it, vi } from 'vitest';
import { resolveAsrHealthConfig, startAsrHealthPolling } from '../asrHealth';

describe('ASR health polling guard (Vercel/Netlify 404 console spam fix)', () => {
  it('disables polling on hosted origins without VITE_ASR_URL and enables when configured or local', () => {
    expect(
      resolveAsrHealthConfig({
        hostname: 'alifbo-eight.vercel.app',
      }),
    ).toEqual({
      shouldPoll: false,
      baseUrl: '',
      healthUrl: '',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: 'my-app.netlify.app',
        configuredAsrUrl: '   ',
      }),
    ).toEqual({
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
      shouldPoll: true,
      baseUrl: 'https://asr.alifbo.uz',
      healthUrl: 'https://asr.alifbo.uz/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: 'localhost',
      }),
    ).toEqual({
      shouldPoll: true,
      baseUrl: '',
      healthUrl: '/api/health',
    });

    expect(
      resolveAsrHealthConfig({
        hostname: '127.0.0.1',
      }),
    ).toEqual({
      shouldPoll: true,
      baseUrl: '',
      healthUrl: '/api/health',
    });
  });

  it('performs zero fetches and zero intervals on Vercel/Netlify when VITE_ASR_URL is absent', () => {
    const fetchMock = vi.fn<typeof fetch>();
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
    expect(onStatus).toHaveBeenCalledWith(false);
    cleanup();
  });

  it('immediately clears polling interval on first HTTP 404 without spamming subsequent checks', async () => {
    const ticks: Array<() => void> = [];
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 404,
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

    // Even if a stray tick fires, stoppedOn404 prevents any further /api/health calls
    ticks[0]?.();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('reports online=true when /api/health responds with HTTP 200 and ok: true', async () => {
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
});
