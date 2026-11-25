import { jsonResponse } from './session.js';
import {
  getConfiguredSttProvider,
  getConfiguredSttProvidersSummary,
} from './stt.js';

export async function handleHealthCheck(): Promise<Response> {
  const provider = getConfiguredSttProvider();
  const configuredProviders = getConfiguredSttProvidersSummary();
  const ttsReady = Boolean(process.env.VOICELAB_API_KEY?.trim());

  if (provider === 'proxy') {
    const proxyBase = (process.env.STT_BACKEND_URL || '').trim().replace(/\/+$/, '');
    try {
      const resp = await fetch(`${proxyBase}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) {
        return jsonResponse({
          ok: true,
          status: 'ready',
          stt_provider: 'proxy',
          tts_ready: ttsReady,
          configured_providers: configuredProviders,
        });
      }
    } catch {
      // Proxy unreachable; check cloud fallback below
    }

    const fallbackProvider = process.env.UZBEKVOICE_API_KEY?.trim()
      ? 'uzbekvoice'
      : process.env.VOICELAB_API_KEY?.trim()
        ? 'voicelab'
        : null;

    if (fallbackProvider) {
      return jsonResponse({
        ok: true,
        status: 'ready',
        stt_provider: fallbackProvider,
        tts_ready: ttsReady,
        configured_providers: configuredProviders,
      });
    }

    return jsonResponse(
      {
        ok: false,
        status: 'offline',
        stt_provider: 'proxy',
        tts_ready: ttsReady,
        configured_providers: configuredProviders,
      },
      503,
    );
  }

  if (provider !== 'none') {
    return jsonResponse({
      ok: true,
      status: 'ready',
      stt_provider: provider,
      tts_ready: ttsReady,
      configured_providers: configuredProviders,
    });
  }

  return jsonResponse(
    {
      ok: false,
      status: 'unconfigured',
      stt_provider: 'none',
      tts_ready: ttsReady,
      configured_providers: configuredProviders,
    },
    503,
  );
}
