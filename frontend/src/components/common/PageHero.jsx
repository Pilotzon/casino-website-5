import styles from "./PageHero.module.css";

function PageHero({
  title = "Casino Games",
  stats = [],
  description = "",
  buttonText = "Surprise me",
  buttonIcon = null,
  onButtonClick,
  image,
  imageAlt = "",
  logo = null,
}) {
  // split stats for mobile two-block layout: Playing in top card, rest in stats card
  const playingStat = stats.find((s) => s.label === "Playing");
  const otherStats = stats.filter((s) => s.label !== "Playing");
  return (
    <>
      {/* Desktop hero - single card */}
      <div className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroMain}>
            <div className={styles.logoBox} aria-hidden="true">
              {logo || <span className={styles.logoText}>Casino</span>}
            </div>
            <div className={styles.textGroup}>
              <h1 className={styles.title}>{title}</h1>
              {stats.length > 0 && (
                <div className={styles.statsRow}>
                  {stats.map((s, i) => (
                    <span key={i} className={styles.stat}>
                      {s.dot && <span className={styles.dot} aria-hidden="true" />}
                      <span className={styles.statValue}>{s.value}</span>
                      <span className={styles.statLabel}>{s.label}</span>
                    </span>
                  ))}
                </div>
              )}
              {onButtonClick && (
                <button type="button" className={styles.actionBtn} onClick={onButtonClick}>
                  {buttonIcon && <span className={styles.actionIcon}>{buttonIcon}</span>}
                  {buttonText}
                </button>
              )}
            </div>
          </div>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        {image && (
          <div className={styles.heroImageWrap} aria-hidden="true">
            <img src={image} alt={imageAlt} className={styles.heroImage} />
          </div>
        )}
      </div>

      {/* Mobile hero - image above first block connected as one block */}
      <div className={styles.heroMobile}>
        <div className={styles.heroMobileMain}>
          {image && (
            <div className={styles.heroMobileImageWrap} aria-hidden="true">
              <img src={image} alt={imageAlt} className={styles.heroMobileImage} />
            </div>
          )}
          <div className={styles.heroMobileTop}>
            <div className={styles.logoBox} aria-hidden="true">
              {logo || <span className={styles.logoText}>Casino</span>}
            </div>
            <div className={styles.heroMobileTopRight}>
              {playingStat && (
                <span className={styles.heroMobilePlaying}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.statValue}>{playingStat.value}</span>
                  <span className={styles.statLabel}>{playingStat.label}</span>
                </span>
              )}
              {onButtonClick && (
                <button type="button" className={styles.heroMobileBtn} onClick={onButtonClick}>
                  {buttonIcon && <span className={styles.heroMobileBtnIcon} aria-hidden="true">{buttonIcon}</span>}
                  {buttonText}
                </button>
              )}
            </div>
          </div>
        </div>
        {otherStats.length > 0 && (
          <div className={styles.heroMobileStats}>
            {otherStats.map((s, i) => (
              <div key={i} className={styles.heroMobileStat}>
                <span className={styles.heroMobileStatValue}>{s.value}</span>
                <span className={styles.heroMobileStatLabel}>{s.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default PageHero;
