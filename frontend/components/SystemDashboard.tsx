'use client';

import { useCallback, useEffect, useState } from 'react';
import type {
  ApiClient,
  DiagnosticResult,
  ModelDiagnostic,
  PlaygroundRequest,
  ProviderDiagnostic,
  SystemStatusData,
  TokenDiagnostic
} from '@/lib/api';
import { ApiError } from '@/lib/api';
import type { ModelMode } from '@/lib/types';

interface SystemDashboardProps {
  api: ApiClient;
  onError: (message: string) => void;
}

function ProviderBadge({ status }: { status: ProviderDiagnostic['status'] }) {
  return <span className={`sys-pill sys-${status}`}>{status}</span>;
}

function HealthBadge({ health }: { health: ModelDiagnostic['health'] }) {
  return <span className={`sys-pill sys-${health}`}>{health}</span>;
}

function fmtMs(value: number | null): string {
  return value === null ? '—' : `${Math.round(value)}ms`;
}

function fmtTime(value: string | number | null): string {
  if (value === null || value === undefined) return '—';
  return new Date(value).toLocaleString();
}

function testResultText(result: DiagnosticResult): string {
  if (result.ok) {
    const model = result.selectedModel ?? 'model';
    const latency = result.latencyMs === undefined ? '' : ` · ${Math.round(result.latencyMs)}ms`;
    const provider = result.providerId ? ` · ${result.providerId}` : '';
    return `Success${provider} · ${model}${latency}`;
  }
  return `Failed · ${result.errorCategory ?? 'UNKNOWN'}${result.errorMessage ? ` · ${result.errorMessage}` : ''}`;
}

const PLAYGROUND_DEFAULT_PROMPT = 'Explain what a vector database is in two sentences.';

export function SystemDashboard({ api, onError }: SystemDashboardProps) {
  const [status, setStatus] = useState<SystemStatusData | null>(null);
  const [providers, setProviders] = useState<ProviderDiagnostic[] | null>(null);
  const [models, setModels] = useState<ModelDiagnostic[] | null>(null);
  const [tokens, setTokens] = useState<TokenDiagnostic[] | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [testingProviders, setTestingProviders] = useState<Set<string>>(new Set());
  const [testResults, setTestResults] = useState<Record<string, DiagnosticResult>>({});

  const [playProvider, setPlayProvider] = useState('');
  const [playModel, setPlayModel] = useState('');
  const [playMode, setPlayMode] = useState<ModelMode>('auto');
  const [playPrompt, setPlayPrompt] = useState(PLAYGROUND_DEFAULT_PROMPT);
  const [playBusy, setPlayBusy] = useState(false);
  const [playResult, setPlayResult] = useState<DiagnosticResult | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [statusData, providerData, modelData, tokenData] = await Promise.all([
        api.getSystemStatus(),
        api.getSystemProviders(),
        api.getSystemModels(),
        api.getSystemTokens()
      ]);
      setStatus(statusData);
      setProviders(providerData);
      setModels(modelData);
      setTokens(tokenData);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Something went wrong loading system data.';
      setError(message);
      onError(message);
    } finally {
      setBusy(false);
    }
  }, [api, onError]);

  useEffect(() => {
    load();
  }, [load]);

  const testProvider = useCallback(
    async (providerId: string) => {
      setTestingProviders((prev) => new Set(prev).add(providerId));
      try {
        const result = await api.testConnection(providerId);
        setTestResults((prev) => ({ ...prev, [providerId]: result }));
      } catch (e) {
        const message = e instanceof ApiError ? e.message : 'Test failed.';
        setTestResults((prev) => ({ ...prev, [providerId]: { ok: false, errorCategory: 'UNKNOWN', errorMessage: message } }));
        onError(message);
      } finally {
        setTestingProviders((prev) => {
          const next = new Set(prev);
          next.delete(providerId);
          return next;
        });
      }
    },
    [api, onError]
  );

  const runPlayground = useCallback(async () => {
    setPlayBusy(true);
    setPlayResult(null);
    try {
      const body: PlaygroundRequest = {
        mode: playMode,
        prompt: playPrompt.trim() || PLAYGROUND_DEFAULT_PROMPT
      };
      if (playProvider) body.provider = playProvider;
      if (playModel) body.model = playModel;
      const result = await api.runPlayground(body);
      setPlayResult(result);
    } catch (e) {
      const message = e instanceof ApiError ? e.message : 'Playground call failed.';
      setPlayResult({ ok: false, errorCategory: 'UNKNOWN', errorMessage: message });
    } finally {
      setPlayBusy(false);
    }
  }, [api, playProvider, playModel, playMode, playPrompt]);

  const online = providers?.filter((p) => p.status !== 'offline').length ?? 0;

  return (
    <div className="system-dashboard">
      <div className="actions sys-actions">
        <button className="btn secondary" onClick={load} disabled={busy}>
          {busy ? 'Refreshing…' : 'Refresh'}
        </button>
        {error && <span className="muted sys-error">{error}</span>}
      </div>

      {status && (
        <div className="sys-overview muted">
          <span>routing: {status.routingEnabled ? 'on' : 'off'}</span>
          <span>default mode: {status.defaultMode}</span>
          <span>{status.enabledModelCount}/{status.modelCount} models enabled</span>
          <span>{online}/{providers?.length ?? 0} providers with tokens</span>
        </div>
      )}

      <section className="sys-section">
        <h4>Providers</h4>
        {providers && providers.length > 0 ? (
          <div className="sys-table">
            {providers.map((provider) => (
              <div className="sys-row" key={provider.providerId}>
                <span className="sys-cell strong">{provider.name}</span>
                <ProviderBadge status={provider.status} />
                <span className="sys-cell">{provider.tokenCount} token{provider.tokenCount === 1 ? '' : 's'}</span>
                <span className="sys-cell">{provider.healthyTokens} healthy</span>
                <span className="sys-cell">{provider.modelCount} models</span>
                <span className="sys-cell code">{provider.baseUrl || provider.kind}</span>
                <span className="sys-cell">
                  <button
                    className="btn secondary sys-test-btn"
                    onClick={() => testProvider(provider.providerId)}
                    disabled={testingProviders.has(provider.providerId)}
                  >
                    {testingProviders.has(provider.providerId) ? 'Testing…' : 'Test'}
                  </button>
                </span>
                {testResults[provider.providerId] && (
                  <span
                    className={`sys-cell sys-test-result ${testResults[provider.providerId].ok ? 'sys-ok' : 'sys-fail'}`}
                  >
                    {testResultText(testResults[provider.providerId])}
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : busy ? (
          <p className="muted">Loading providers…</p>
        ) : (
          <p className="muted">No providers configured. Add provider API keys to the backend environment.</p>
        )}
      </section>

      <section className="sys-section">
        <h4>Tokens <span className="muted sys-count">(masked; server-side only)</span></h4>
        {tokens && tokens.length > 0 ? (
          <div className="sys-table">
            {tokens.map((token) => (
              <div className="sys-row" key={token.id}>
                <span className="sys-cell code">{token.masked}</span>
                <span className="sys-cell">{token.providerId}</span>
                {token.healthy ? <span className="sys-pill sys-healthy">healthy</span> : <span className="sys-pill sys-auth_error">down</span>}
                {token.inCooldown && <span className="sys-pill sys-rate_limited">cooldown</span>}
                <span className="sys-cell">{token.successCount} ok</span>
                <span className="sys-cell">{token.failureCount} fail</span>
                {token.lastFailureCategory && (
                  <span className="sys-cell">{token.lastFailureCategory} · {fmtTime(token.lastFailureAt)}</span>
                )}
              </div>
            ))}
          </div>
        ) : busy ? (
          <p className="muted">Loading tokens…</p>
        ) : (
          <p className="muted">No tokens registered.</p>
        )}
      </section>

      <section className="sys-section">
        <h4>Models</h4>
        <p className="muted sys-note">
          The router scores candidates on capabilities, health, latency, quality/speed/cost and priority, then picks a
          fresh model for each agent stage with automatic fallback.
        </p>
        {models && models.length > 0 ? (
          <div className="sys-table">
            {models.map((model) => (
              <div className="sys-row" key={model.key}>
                <span className="sys-cell strong code">
                  {model.providerId}/{model.modelId}
                </span>
                <HealthBadge health={model.health} />
                <span className="sys-cell">{model.verified ? 'verified' : 'candidate'}</span>
                <span className="sys-cell">{fmtMs(model.avgLatencyMs)} avg</span>
                {model.contextWindow !== null && <span className="sys-cell">{(model.contextWindow / 1000).toFixed(0)}k ctx</span>}
                <span className="sys-cell sys-caps">
                  {model.capabilities.tools ? 'tools ' : ''}
                  {model.capabilities.structuredOutput ? 'structured ' : ''}
                  {model.capabilities.vision ? 'vision ' : ''}
                  {model.capabilities.embeddings ? 'embeddings' : ''}
                </span>
              </div>
            ))}
          </div>
        ) : busy ? (
          <p className="muted">Loading models…</p>
        ) : (
          <p className="muted">No models registered.</p>
        )}
      </section>

      <section className="sys-section">
        <h4>Playground <span className="muted sys-count">(diagnostics; no credentials shown)</span></h4>
        <div className="sys-table">
          <div className="sys-row">
            <label className="sys-cell">
              <span className="muted">Provider</span>
              <select value={playProvider} onChange={(e) => setPlayProvider(e.target.value)} aria-label="Playground provider">
                <option value="">Auto</option>
                {(providers ?? []).map((provider) => (
                  <option key={provider.providerId} value={provider.providerId}>{provider.name}</option>
                ))}
              </select>
            </label>
            <label className="sys-cell">
              <span className="muted">Model</span>
              <select value={playModel} onChange={(e) => setPlayModel(e.target.value)} aria-label="Playground model">
                <option value="">Auto</option>
                {(models ?? [])
                  .filter((model) => !playProvider || model.providerId === playProvider)
                  .map((model) => (
                    <option key={model.key} value={model.key}>
                      {model.providerId}/{model.modelId}
                    </option>
                  ))}
              </select>
            </label>
            <label className="sys-cell">
              <span className="muted">Mode</span>
              <select
                value={playMode}
                onChange={(e) => setPlayMode(e.target.value as ModelMode)}
                aria-label="Playground mode"
              >
                {(['auto', 'quality', 'balanced', 'fast', 'lowcost'] as const).map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="sys-row">
            <textarea
              className="sys-play-prompt"
              value={playPrompt}
              onChange={(e) => setPlayPrompt(e.target.value)}
              maxLength={4000}
              rows={2}
              aria-label="Playground prompt"
            />
          </div>
          <div className="sys-row">
            <button className="btn secondary" onClick={runPlayground} disabled={playBusy}>
              {playBusy ? 'Running…' : 'Run'}
            </button>
            {playResult && (
              <span className={`sys-cell sys-test-result ${playResult.ok ? 'sys-ok' : 'sys-fail'}`}>
                {testResultText(playResult)}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}