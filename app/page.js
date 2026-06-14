"use client";

import { useEffect, useState, useCallback } from "react";

const API_KEY = process.env.NEXT_PUBLIC_CRICAPI_KEY;
const API_URL = `https://api.cricapi.com/v1/currentMatches?offset=0&apikey=${API_KEY}`;

export default function Home() {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_URL, { cache: "no-store" });
      const data = await res.json();
      if (data.status !== "success") {
        throw new Error(data.reason || data.status || "Request failed");
      }
      const list = (data.data || []).map((m) => ({
        id: m.id,
        name: m.name,
        status: m.status,
        score: (m.score || []).map((s) => ({
          inning: s.inning,
          runs: s.r,
          wickets: s.w,
          overs: s.o,
        })),
      }));
      setMatches(list);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <main className="container">
      <div className="header">
        <h1>🏏 Cricket Live Score</h1>
        <button className="refresh-btn" onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div className="error">Error: {error}</div>}

      {!error && !loading && matches.length === 0 && (
        <p className="muted">No current matches.</p>
      )}

      {matches.map((m) => (
        <div key={m.id} className="card">
          <div className="name">{m.name}</div>
          <div className="status">{m.status}</div>
          <div className="score">
            {m.score.length > 0
              ? m.score.map((s, i) => (
                  <div key={i}>
                    {s.inning}: {s.runs}/{s.wickets} ({s.overs} ov)
                  </div>
                ))
              : "Yet to start"}
          </div>
        </div>
      ))}
    </main>
  );
}
