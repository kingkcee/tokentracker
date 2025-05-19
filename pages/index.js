// pages/index.js
import { useState } from 'react';

export default function Home() {
  const [address, setAddress] = useState('');
  const [error, setError]     = useState('');
  const [pumpResult, setPump] = useState(null);
  const [dexResult, setDex]   = useState(null);
  const [loading, setLoading] = useState(false);

  const scan = async (source) => {
    setError('');
    setPump(null);
    setDex(null);
    setLoading(true);

    if (!address) {
      setError('Please enter a token address.');
      setLoading(false);
      return;
    }

    try {
      const res  = await fetch(`/api/${source}?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Scan failed.');
      if (source === 'pumpfun') setPump(data);
      else                      setDex(data);
    } catch (err) {
      console.error(err);
      setError(err.message || 'Network error.');
    } finally {
      setLoading(false);
    }
  };

  const monitor = async (source) => {
    try {
      const res = await fetch('/api/monitor', {
        method:  'POST',
        headers: {'Content-Type':'application/json'},
        body:    JSON.stringify({ source, address })
      });
      const json = await res.json();
      alert(json.message || json.error);
    } catch {
      alert('Failed to set up monitor.');
    }
  };

  return (
    <div className="container">
      <h1>Solana Token Checker</h1>

      <input
        type="text"
        placeholder="Paste token mint address"
        value={address}
        onChange={e => setAddress(e.target.value.trim())}
        disabled={loading}
      />

      <div className="button-row">
        <button onClick={() => scan('pumpfun')} disabled={loading}>
          Scan with Pump.fun
        </button>
        <button onClick={() => scan('dexscreener')} disabled={loading}>
          Scan with DexScreener
        </button>
      </div>

      {loading && <div className="spinner" />}

      {error && <p className="error">{error}</p>}

      {pumpResult && (
        <section className="card">
          <h2>{pumpResult.name} ({pumpResult.symbol})</h2>
          <p><strong>Market Cap (USD):</strong> ${pumpResult.marketCap}</p>
          <p><strong>Buy Score:</strong> {pumpResult.buyScore}%</p>
          <p><strong>Predicted ROI:</strong> {pumpResult.predictedRoi}</p>
          {(pumpResult.warnings ?? []).length > 0 && (
            <div>
              <strong>Warnings:</strong>
              <ul>
                {(pumpResult.warnings ?? []).map((w,i)=><li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <button onClick={()=>monitor('pumpfun')}>Ape & Monitor</button>
        </section>
      )}

      {dexResult && (
        <section className="card">
          <h2>{dexResult.name} ({dexResult.symbol})</h2>
          <p><strong>Market Cap (USD):</strong> ${dexResult.marketCap}</p>
          <p><strong>Buy Score:</strong> {dexResult.buyScore}%</p>
          <p><strong>Predicted ROI:</strong> {dexResult.predictedRoi}</p>
          {(dexResult.warnings ?? []).length > 0 && (
            <div>
              <strong>Warnings:</strong>
              <ul>
                {(dexResult.warnings ?? []).map((w,i)=><li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
          <button onClick={()=>monitor('dexscreener')}>Ape & Monitor</button>
        </section>
      )}

      <style jsx>{`
        .container {
          background: #121212;
          color: #eee;
          min-height: 100vh;
          padding: 2rem;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        h1 {
          text-align: center;
          margin-bottom: 1.5rem;
        }
        input {
          width: 100%;
          padding: 0.75rem 1rem;
          font-size: 1rem;
          border: none;
          border-radius: 12px;
          margin-bottom: 1rem;
          background: #1e1e1e;
          color: #fff;
        }
        .button-row {
          display: flex;
          gap: 0.5rem;
          margin-bottom: 1rem;
        }
        button {
          flex: 1;
          padding: 0.75rem;
          font-size: 1rem;
          border: none;
          border-radius: 12px;
          background: #2e2e2e;
          color: #fff;
          cursor: pointer;
          transition: background 0.2s;
        }
        button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        button:hover:not(:disabled) {
          background: #3e3e3e;
        }
        .spinner {
          margin: 2rem auto;
          border: 4px solid #333;
          border-top: 4px solid #fff;
          border-radius: 50%;
          width: 40px;
          height: 40px;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        .error {
          color: #ff4d4f;
          text-align: center;
          margin-top: 1rem;
        }
        .card {
          background: #1e1e1e;
          padding: 1rem;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.5);
          margin-bottom: 1rem;
        }
        .card h2 {
          margin-top: 0;
        }
      `}</style>
    </div>
  );
}
