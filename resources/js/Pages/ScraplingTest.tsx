import React, { useState } from 'react';
import AppLayout from '../Layouts/AppLayout';
import { Bug, Search, Globe, Play, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react';

export default function ScraplingTestPage() {
  const [query, setQuery] = useState('Handwerker Berlin');
  const [url, setUrl] = useState('https://example.com');
  const [mode, setMode] = useState<'search' | 'scrape'>('search');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  const handleTest = async () => {
    setLoading(true);
    setResults(null);
    try {
      if (mode === 'search') {
        const res = await fetch('/api/settings/test-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'serper', query }),
        });
        setResults(await res.json());
      } else {
        const res = await fetch('/api/settings/test-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'firecrawl', query: url }),
        });
        setResults(await res.json());
      }
    } catch (e: any) {
      setResults({ error: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <AppLayout>
      <div className="max-w-3xl mx-auto space-y-6 pb-16">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bug className="w-5 h-5 text-rose-500" />
            Scrapling & Web-Engine Test
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Testen der Web-Scraping und Suchmaschinen-Integrationen.
          </p>
        </div>

        <div className="p-5 rounded-xl space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex gap-2">
            <button
              onClick={() => setMode('search')}
              className="btn-v2"
              style={{
                background: mode === 'search' ? 'var(--orange-soft)' : 'var(--bg)',
                borderColor: mode === 'search' ? 'var(--orange)' : 'var(--border)',
                color: mode === 'search' ? 'var(--orange)' : 'var(--text-1)',
              }}
            >
              <Search className="w-3.5 h-3.5" /> Suche testen
            </button>
            <button
              onClick={() => setMode('scrape')}
              className="btn-v2"
              style={{
                background: mode === 'scrape' ? 'var(--orange-soft)' : 'var(--bg)',
                borderColor: mode === 'scrape' ? 'var(--orange)' : 'var(--border)',
                color: mode === 'scrape' ? 'var(--orange)' : 'var(--text-1)',
              }}
            >
              <Globe className="w-3.5 h-3.5" /> URL Scraping testen
            </button>
          </div>

          <div>
            <label className="text-[11px] font-semibold uppercase tracking-wider block mb-1 text-slate-500">
              {mode === 'search' ? 'Suchbegriff' : 'Ziel-URL'}
            </label>
            <input
              type="text"
              value={mode === 'search' ? query : url}
              onChange={e => mode === 'search' ? setQuery(e.target.value) : setUrl(e.target.value)}
              className="w-full border rounded px-3 py-1.5 text-xs outline-none"
              style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}
            />
          </div>

          <button
            onClick={handleTest}
            disabled={loading}
            className="btn-v2 btn-v2-primary"
          >
            {loading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Test ausführen
          </button>
        </div>

        {results && (
          <div className="p-4 rounded-xl border text-xs font-mono overflow-x-auto max-h-80" style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}>
            <pre>{JSON.stringify(results, null, 2)}</pre>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
