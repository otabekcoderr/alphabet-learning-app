import { jsonResponse } from './session.js';
import {
  getConfiguredSttProvider,
  getConfiguredSttProvidersSummary,
  isCloudSttFallbackEnabled,
} from './stt.js';

const DEFAULT_HEALTH_PROXY_TIMEOUT_MS = 20_000;

function getProxyHealthTimeoutMs(): number {
  const parsed = Number(process.env.STT_HEALTH_TIMEOUT_MS || '');
  if (Number.isFinite(parsed) && parsed >= 3_000) {
    return Math.min(25_000, Math.round(parsed));
  }
  return DEFAULT_HEALTH_PROXY_TIMEOUT_MS;
}

export async function handleHealthCheck(): Promise<Response> {
  const provider = getConfiguredSttProvider();
  const configuredProviders = getConfiguredSttProvidersSummary();
  const ttsReady = Boolean(process.env.VOICELAB_API_KEY?.trim());

  if (provider === 'proxy') {
    const proxyBase = (process.env.STT_BACKEND_URL || '').trim().replace(/\/+$/, '');
    try {
      const resp = await fetch(`${proxyBase}/api/health`, {
        signal: AbortSignal.timeout(getProxyHealthTimeoutMs()),
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
      // Proxy unreachable or timed out
    }

    if (isCloudSttFallbackEnabled()) {
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
