import { useEffect, useState } from "react";
import { customBetsAPI } from "../../../services/api";
import styles from "./MarketFull.module.css";

function fmtEnds(end_at) {
  const t = new Date(end_at).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

export default function MarketFull() {
  const [loading, setLoading] = useState(true);
  const [markets, setMarkets] = useState([]);
  const [q, setQ] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await customBetsAPI.list({ status: "open", limit: 120, offset: 0, q });
      setMarkets(res.data?.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.title}>Custom Bets</h1>
            <div className={styles.sub}>All markets (grid)</div>
          </div>

          <div className={styles.search}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets…" />
            <button onClick={load}>Search</button>
          </div>
        </div>

        {loading ? (
          <div className={styles.muted}>Loading…</div>
        ) : (
          <div className={styles.grid}>
            {markets.map((m) => (
              <a key={m.id} className={styles.card} href={`/custom-bets#${m.id}`}>
                <div className={styles.cardTop}>
                  <div className={styles.creator}>@{m.creator_username}</div>
                  <div className={styles.ends}>Ends: {fmtEnds(m.end_at)}</div>
                </div>

                <div className={styles.cardTitle}>{m.title}</div>
                {m.description ? <div className={styles.desc}>{m.description}</div> : null}

                <div className={styles.options}>
                  {(m.options || []).slice(0, 3).map((o) => (
                    <div key={o.id} className={styles.opt}>
                      <div className={styles.optLabel}>{o.label}</div>
                      <div className={styles.optTotal}>{Number(o.total || 0).toFixed(2)}</div>
                    </div>
                  ))}
                  {(m.options || []).length > 3 ? (
                    <div className={styles.more}>+{m.options.length - 3} more</div>
                  ) : null}
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}