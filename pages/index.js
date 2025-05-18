import { useState } from 'react';

export default function Home() {
  const [address, setAddress] = useState('');
  const [error, setError]     = useState('');
  const [pumpResult, setPump] = useState(null);
  const [dexResult,  setDex]  = useState(null);

  const scan = async (source) => {
    setError('');
    setPump(null);
    setDex(null);
    if (!address) {
      setError('Please enter a token address.');
      return;
    }
    try {
      const res = await fetch(`/api/${source}?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!data.success) {
        setError(data.error || 'Scan failed.');
      } else if (source === 'pumpfun') {
        setPump(data);
      } else {
        setDex(data);
      }
    } catch {
      setError('Network error.');
    }
  };

  return (
    <main style={{ maxWidth: 600, margin: '40px auto', fontFamily: 'Arial, sans-serif' }}>
      <h1>Solana Token Checker</h1>

      <input
        type="text"
        placeholder="Paste token mint address"
        value={address}
        onChange={e => setAddress(e.target.value)}
        style={{ width: '100%', padding: 8, fontSize: 16 }}
      />

      <div style={{ margin: '20px 0' }}>
        <button
          onClick={() => scan('pumpfun')}
          style={{ marginRight: 8, padding: '8px 16px' }}
        >
          Scan with Pump.fun
        </button>
        <button
          onClick={() => scan('dexscreener')}
          style={{ padding: '8px 16px' }}
        >
          Scan with DexScreener
        </button>
      </div>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      {pumpResult && (
        <section style={{ border: '1px solid #ccc', padding: 12, marginBottom: 20 }}>
          <h2>Pump.fun Results</h2>
          <p><strong>Market Cap (USD):</strong> ${pumpResult.marketCap}</p>
          <p><strong>Buy Score:</strong> {pumpResult.buyScore}%</p>
          <p><strong>Predicted ROI:</strong> {pumpResult.predictedRoi}</p>
          {pumpResult.warnings.length > 0 && (
            <div>
              <strong>Warnings:</strong>
              <ul>
                {pumpResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}

      {dexResult && (
        <section style={{ border: '1px solid #ccc', padding: 12 }}>
          <h2>DexScreener Results</h2>
          <p><strong>Market Cap (USD):</strong> ${dexResult.marketCap}</p>
          <p><strong>Buy Score:</strong> {dexResult.buyScore}%</p>
          <p><strong>Predicted ROI:</strong> {dexResult.predictedRoi}</p>
          {dexResult.warnings.length > 0 && (
            <div>
              <strong>Warnings:</strong>
              <ul>
                {dexResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
