import styles from "./CustomBetGraph.module.css";

export default function CustomBetGraph({ points = [] }) {
  const w = 520;
  const h = 140;
  const pad = 10;

  if (!points || points.length < 2) {
    return <div className={styles.empty}>No graph data</div>;
  }

  const ys = points.map((p) => Number(p) || 0);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const span = maxY - minY || 1;

  const xTo = (i) => pad + (i * (w - pad * 2)) / Math.max(1, ys.length - 1);
  const yTo = (y) => pad + (h - pad * 2) * (1 - (y - minY) / span);

  const d = ys
    .map((y, i) => `${i === 0 ? "M" : "L"} ${xTo(i).toFixed(2)} ${yTo(y).toFixed(2)}`)
    .join(" ");

  return (
    <div className={styles.wrap}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} className={styles.svg}>
        <path d={d} className={styles.path} fill="none" />
      </svg>
    </div>
  );
}