import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { customBetsAPI } from "../../../services/api";
import { useAuth } from "../../../context/AuthContext";
import { useToast } from "../../../context/ToastContext";
import styles from "./Home.module.css";

function fmtEnds(end_at) {
  const t = new Date(end_at).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t).toLocaleString();
}

function sumPercents(options) {
  return options.reduce((s, o) => s + (Number(o.percent) || 0), 0);
}

export default function Home() {
  const toast = useToast();
  const nav = useNavigate();
  const loc = useLocation();
  const { isAuthenticated } = useAuth();

  const [loading, setLoading] = useState(true);
  const [markets, setMarkets] = useState([]);
  const [q, setQ] = useState("");

  const qs = new URLSearchParams(loc.search);
  const createOpen = qs.get("create") === "1";

  const [createData, setCreateData] = useState({
    title: "",
    description: "",
    showGraph: true,
    showPercentages: false,
    endAtLocal: "", // "YYYY-MM-DDTHH:mm" from datetime-local
    options: [
      { label: "Option A", percent: 50 },
      { label: "Option B", percent: 50 },
    ],
  });

  const [imageFile, setImageFile] = useState(null);

  const percentTotal = useMemo(() => sumPercents(createData.options), [createData.options]);
  const percentOk = !createData.showPercentages || Math.abs(percentTotal - 100) < 0.000001;

  const closeCreate = () => nav("/custom-bets", { replace: true });

  const load = async () => {
    setLoading(true);
    try {
      const res = await customBetsAPI.list({ status: "open", limit: 60, offset: 0, q });
      setMarkets(res.data?.data ?? []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addOption = () => setCreateData((p) => ({ ...p, options: [...p.options, { label: "", percent: 0 }] }));
  const removeOption = (idx) => setCreateData((p) => ({ ...p, options: p.options.filter((_, i) => i !== idx) }));
  const setOption = (idx, patch) =>
    setCreateData((p) => ({ ...p, options: p.options.map((o, i) => (i === idx ? { ...o, ...patch } : o)) }));

  const createMarket = async () => {
    if (!isAuthenticated) return toast.error("Login required to create");
    if (!createData.title.trim()) return toast.error("Prediction Name is required");

    const cleanOptions = (createData.options || [])
      .map((o) => ({ ...o, label: String(o.label || "").trim() }))
      .filter((o) => o.label);

    if (cleanOptions.length < 2) return toast.error("At least 2 options required");

    // ✅ IMPORTANT FIX: send datetime-local string directly, backend will parse it consistently
    const endAtLocal = String(createData.endAtLocal || "").trim();
    if (!endAtLocal) return toast.error("Please choose an end date/time");

    // basic validation: must be in the future (client side)
    const endMs = new Date(endAtLocal).getTime();
    if (!Number.isFinite(endMs)) return toast.error("Invalid end date/time");
    if (endMs <= Date.now() + 30 * 1000) return toast.error("End time must be in the future");

    if (createData.showPercentages) {
      if (!percentOk) return toast.error("Percentages must add up to exactly 100%");
      for (const o of cleanOptions) {
        const n = Number(o.percent);
        if (!Number.isFinite(n) || n < 0 || n > 100) return toast.error("Invalid percentage value");
      }
    }

    const optionsPayload = cleanOptions.map((o) => ({
      label: o.label,
      creator_percent: createData.showPercentages ? Number(o.percent) : undefined,
    }));

    try {
      const fd = new FormData();
      fd.append("title", createData.title);
      fd.append("description", createData.description || "");
      fd.append("showGraph", String(createData.showGraph));
      fd.append("showPercentages", String(createData.showPercentages));

      // ✅ send local datetime string
      fd.append("endAt", endAtLocal);

      fd.append("options", JSON.stringify(optionsPayload));
      if (imageFile) fd.append("image", imageFile);

      const res = await customBetsAPI.create(fd);
      const bet = res.data?.data;

      toast.success("Market created");
      closeCreate();
      await load();

      if (bet?.id) nav(`/custom-bets/bet/${bet.id}`);
    } catch (e) {
      toast.error(e.response?.data?.message || "Create failed");
    }
  };

  // drag-close fix
  const mouseDownOnBackdropRef = useRef(false);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <div className={styles.top}>
          <div>
            <h1 className={styles.title}>Custom Bets</h1>
            <div className={styles.sub}>Browse markets</div>
          </div>

          <div className={styles.search}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search markets..." />
            <button onClick={load} type="button">Search</button>
          </div>
        </div>

        {loading ? (
          <div className={styles.muted}>Loading…</div>
        ) : (
          <div className={styles.grid}>
            {markets.map((m) => (
              <Link key={m.id} to={`/custom-bets/bet/${m.id}`} className={styles.card}>
                <div className={styles.cardTop}>
                  <div className={styles.creator}>@{m.creator_username}</div>
                  <div className={styles.ends}>Ends: {fmtEnds(m.end_at)}</div>
                </div>

                <div className={styles.cardTitle}>{m.title}</div>
                {m.description ? <div className={styles.desc}>{m.description}</div> : null}

                <div className={styles.metaBottom}>
                  <div className={styles.pool}>
                    ${Number(m.pool_total || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })} Vol.
                  </div>
                  <div className={styles.opts}>{(m.options || []).length} options</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {createOpen && (
        <div
          className={styles.modalBackdrop}
          onMouseDown={(e) => {
            mouseDownOnBackdropRef.current = e.target === e.currentTarget;
          }}
          onClick={(e) => {
            if (mouseDownOnBackdropRef.current && e.target === e.currentTarget) closeCreate();
          }}
        >
          <div className={styles.modal} onMouseDown={() => (mouseDownOnBackdropRef.current = false)}>
            <div className={styles.modalHeader}>
              <div className={styles.modalTitle}>Create Custom Bet</div>
              <button className={styles.modalClose} onClick={closeCreate} type="button">✕</button>
            </div>

            <div className={styles.form}>
              <div className={styles.field}>
                <label>Prediction Name</label>
                <input value={createData.title} onChange={(e) => setCreateData((p) => ({ ...p, title: e.target.value }))} />
              </div>

              <div className={styles.field}>
                <label>Description (optional)</label>
                <textarea value={createData.description} onChange={(e) => setCreateData((p) => ({ ...p, description: e.target.value }))} />
              </div>

              <div className={styles.field}>
                <label>Image (optional)</label>
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  onChange={(e) => setImageFile(e.target.files?.[0] || null)}
                />
                {imageFile ? <div className={styles.fileHint}>{imageFile.name}</div> : null}
              </div>

              <div className={styles.rowToggles}>
                <button
                  className={`${styles.toggle} ${createData.showGraph ? styles.on : styles.off}`}
                  type="button"
                  onClick={() => setCreateData((p) => ({ ...p, showGraph: !p.showGraph }))}
                >
                  Graph: {createData.showGraph ? "Yes" : "No"}
                </button>

                <button
                  className={`${styles.toggle} ${createData.showPercentages ? styles.on : styles.off}`}
                  type="button"
                  onClick={() =>
                    setCreateData((p) => ({
                      ...p,
                      showPercentages: !p.showPercentages,
                      options: !p.showPercentages
                        ? (() => {
                            const n = Math.max(2, p.options.length);
                            const base = Math.floor((100 / n) * 100) / 100;
                            let remaining = 100;
                            return p.options.map((o, i) => {
                              const v = i === n - 1 ? remaining : base;
                              remaining -= v;
                              return { ...o, percent: v };
                            });
                          })()
                        : p.options,
                    }))
                  }
                >
                  Manual %: {createData.showPercentages ? "On" : "Off"}
                </button>

                {createData.showPercentages && (
                  <div className={`${styles.sum} ${percentOk ? styles.sumOk : styles.sumBad}`}>
                    Total: {percentTotal.toFixed(2)}%
                  </div>
                )}
              </div>

              <div className={styles.field}>
                <label>End date/time</label>
                <input
                  type="datetime-local"
                  value={createData.endAtLocal}
                  onChange={(e) => setCreateData((p) => ({ ...p, endAtLocal: e.target.value }))}
                />
              </div>

              <div className={styles.optionsBlock}>
                <div className={styles.optionsHeader}>
                  <div className={styles.optionsTitle}>Options</div>
                  <button className={styles.addBtn} onClick={addOption} type="button">
                    + Add option
                  </button>
                </div>

                <div className={styles.optionsList}>
                  {createData.options.map((o, idx) => (
                    <div key={idx} className={styles.optionRow}>
                      <input
                        className={styles.optionInput}
                        value={o.label}
                        onChange={(e) => setOption(idx, { label: e.target.value })}
                        placeholder={`Option ${idx + 1}`}
                      />

                      {createData.showPercentages && (
                        <div className={styles.percentWrap}>
                          <input
                            className={styles.percentInput}
                            value={String(o.percent ?? "")}
                            onChange={(e) => setOption(idx, { percent: e.target.value })}
                            inputMode="decimal"
                            placeholder="0"
                          />
                          <span className={styles.percentSign}>%</span>
                        </div>
                      )}

                      <button
                        className={styles.removeBtn}
                        onClick={() => removeOption(idx)}
                        type="button"
                        disabled={createData.options.length <= 2}
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>

                {createData.showPercentages && !percentOk && (
                  <div className={styles.warn}>Percentages must add up to exactly 100%.</div>
                )}
              </div>
            </div>

            <div className={styles.modalActions}>
              <button className={styles.secondaryBtn} onClick={closeCreate} type="button">
                Cancel
              </button>
              <button className={styles.primaryBtn} onClick={createMarket} type="button" disabled={!isAuthenticated || !percentOk}>
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}