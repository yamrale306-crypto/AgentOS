import { useState, useEffect } from 'react';
import { X, Server, Database, Cpu, CheckCircle2, AlertTriangle, RefreshCw, Key } from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [apiUrl, setApiUrl] = useState('');
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'ok' | 'fail'>('idle');
  const [testMessage, setTestMessage] = useState('');

  useEffect(() => {
    if (open) {
      setApiUrl(localStorage.getItem('agentos_api_url') || 'http://localhost:10000');
      setSupabaseUrl(localStorage.getItem('agentos_supabase_url') || '');
      setSupabaseAnonKey(localStorage.getItem('agentos_supabase_anon_key') || '');
      setTestStatus('idle');
      setTestMessage('');
    }
  }, [open]);

  if (!open) return null;

  async function handleTestBackend() {
    setTestStatus('testing');
    setTestMessage('Checking backend /health endpoint...');
    try {
      const res = await fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        setTestStatus('ok');
        setTestMessage('Backend reachable: HTTP 200 OK');
      } else {
        setTestStatus('fail');
        setTestMessage(`Backend responded with status ${res.status}`);
      }
    } catch {
      setTestStatus('fail');
      setTestMessage('Cannot reach backend. Make sure the backend service is running on the specified host.');
    }
  }

  function handleSave() {
    if (apiUrl) localStorage.setItem('agentos_api_url', apiUrl.trim());
    if (supabaseUrl) localStorage.setItem('agentos_supabase_url', supabaseUrl.trim());
    if (supabaseAnonKey) localStorage.setItem('agentos_supabase_anon_key', supabaseAnonKey.trim());
    if (onSaved) onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        id="settings-modal-backdrop"
        onClick={onClose}
        className="fixed inset-0 bg-black/75 backdrop-blur-xs transition-opacity"
      />

      <div
        id="settings-modal-card"
        className="relative w-full max-w-lg rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl p-6 z-10 space-y-5"
      >
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <Server size={18} className="text-blue-400" />
            <h2 className="text-base font-bold text-slate-100">System & API Configuration</h2>
          </div>
          <button
            id="close-settings-modal-btn"
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 text-xs">
          {/* Backend API URL */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Backend API Base URL
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={apiUrl}
                onChange={(e) => setApiUrl(e.target.value)}
                placeholder="http://localhost:10000 or https://agentos-api.render.com"
                className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono text-xs"
              />
              <button
                type="button"
                onClick={handleTestBackend}
                disabled={testStatus === 'testing'}
                className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-750 text-slate-200 font-medium transition-colors shrink-0 flex items-center gap-1.5"
              >
                <RefreshCw size={12} className={testStatus === 'testing' ? 'animate-spin' : ''} />
                <span>Test</span>
              </button>
            </div>
            {testMessage && (
              <p
                className={`mt-1.5 font-medium flex items-center gap-1 ${
                  testStatus === 'ok'
                    ? 'text-emerald-400'
                    : testStatus === 'fail'
                    ? 'text-rose-400'
                    : 'text-slate-400'
                }`}
              >
                {testStatus === 'ok' && <CheckCircle2 size={13} />}
                {testStatus === 'fail' && <AlertTriangle size={13} />}
                <span>{testMessage}</span>
              </p>
            )}
          </div>

          {/* Supabase URL */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Supabase Project URL (Optional)
            </label>
            <input
              type="text"
              value={supabaseUrl}
              onChange={(e) => setSupabaseUrl(e.target.value)}
              placeholder="https://xyzcompany.supabase.co"
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono text-xs"
            />
          </div>

          {/* Supabase Anon Key */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Supabase Anon Key (Optional)
            </label>
            <input
              type="password"
              value={supabaseAnonKey}
              onChange={(e) => setSupabaseAnonKey(e.target.value)}
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-blue-500 font-mono text-xs"
            />
          </div>

          {/* Specs note */}
          <div className="p-3 rounded-lg bg-slate-950/80 border border-slate-800/80 text-slate-400 space-y-1 text-[11px] leading-relaxed">
            <div className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Cpu size={12} className="text-blue-400" />
              <span>Agent Specifications</span>
            </div>
            <p>• Model Routing: OpenRouter primary → fallback with automated timeout fallback</p>
            <p>• Search Engine: DuckDuckGo sanitized with URL decode & snippet deduplication</p>
            <p>• Verification: 2-stage consistency cross-check with honest partial failure reporting</p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <button
            type="button"
            onClick={onClose}
            className="px-3.5 py-1.5 rounded-lg text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            id="save-settings-btn"
            type="button"
            onClick={handleSave}
            className="px-4 py-1.5 rounded-lg text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white transition-colors"
          >
            Save Configuration
          </button>
        </div>
      </div>
    </div>
  );
}
