import { useState } from 'react';

export default function Home() {
  // ... your existing state/hooks ...

  const monitor = async (source, addr) => {
    const res = await fetch('/api/monitor', {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ source, address: addr })
    });
    const j = await res.json();
    alert(j.message);
  };

  return (
    <main>
      {/* ... your existing input & Scan buttons ... */}

      {/* Pump.fun results */}
      {pumpResult && (
        <section>
          {/* … existing results display … */}
          <button
            onClick={() => monitor('pumpfun', address)}
            style={{ marginTop: 8, padding: '6px 12px' }}
          >
            Ape & Monitor
          </button>
        </section>
      )}

      {/* DexScreener results */}
      {dexResult && (
        <section>
          {/* … existing results display … */}
          <button
            onClick={() => monitor('dexscreener', address)}
            style={{ marginTop: 8, padding: '6px 12px' }}
          >
            Ape & Monitor
          </button>
        </section>
      )}
    </main>
  );
}
