import styles from "./CustomBetsNav.module.css";

export default function CustomBetsNav() {
  const tabs = [
    "Trending","Breaking","New","Politics","Sports","Crypto","Finance","Geopolitics","Earnings",
    "Tech","Culture","World","Economy","Climate & Science","Mentions"
  ];

  return (
    <div className={styles.wrap}>
      <div className={styles.inner}>
        {tabs.map((t) => (
          <button
            key={t}
            className={styles.tab}
            type="button"
            onClick={() => {
              window.location.href = "/custom-bets#1";
            }}
          >
            {t}
          </button>
        ))}
      </div>
    </div>
  );
}