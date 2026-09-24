import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { useEffect, useMemo, useRef, useState } from "react";
import api from "../services/api";
import Button from "../components/common/Button";
import styles from "./Home.module.css";

import heroBanner from "../assets/hero-banner.jpg";

// Posters (src/assets/game-posters/)
import flipPoster from "../assets/game-posters/flip.png";
import dicePoster from "../assets/game-posters/dice.png";
import limboPoster from "../assets/game-posters/limbo.png";
import plinkoPoster from "../assets/game-posters/plinko.png";
import crashPoster from "../assets/game-posters/crash.png";
import minesPoster from "../assets/game-posters/mines.png";
import roulettePoster from "../assets/game-posters/roulette.png";
import blackjackPoster from "../assets/game-posters/blackjack.png";
import kenoPoster from "../assets/game-posters/keno.png";
import towerPoster from "../assets/game-posters/tower.png";
import russianRoulettePoster from "../assets/game-posters/RussianRoulette.png";
import wheelPoster from "../assets/game-posters/wheel.png";
import snakesPoster from "../assets/game-posters/snakes.png";
import rpsPoster from "../assets/game-posters/rps.png";
import fallbackPoster from "../assets/game-posters/fallback.png";

const GAME_CATALOG = [
  { name: "flip", display_name: "Coin Flip", poster: flipPoster, subtitle: "Original" },
  { name: "dice", display_name: "Dice", poster: dicePoster, subtitle: "Original" },
  { name: "limbo", display_name: "Limbo", poster: limboPoster, subtitle: "Original" },
  { name: "keno", display_name: "Keno", poster: kenoPoster, subtitle: "Original" },
  { name: "wheel", display_name: "Wheel", poster: wheelPoster, subtitle: "Original" },
  { name: "mines", display_name: "Mines", poster: minesPoster, subtitle: "Original" },
  { name: "plinko", display_name: "Plinko", poster: plinkoPoster, subtitle: "Original" },
  { name: "snakes", display_name: "Snakes & Ladders", poster: snakesPoster, subtitle: "Original" },
  { name: "tower", display_name: "Tower", poster: towerPoster, subtitle: "Original" },
  { name: "roulette", display_name: "Roulette", poster: roulettePoster, subtitle: "Classic" },
  { name: "crash", display_name: "Crash", poster: crashPoster, subtitle: "Original" },
  { name: "rps", display_name: "Rock Paper Scissors", poster: rpsPoster, subtitle: "Original" },
  { name: "blackjack", display_name: "Blackjack", poster: blackjackPoster, subtitle: "Classic" },
  { name: "russian_roulette", display_name: "Russian Roulette", poster: russianRoulettePoster, subtitle: "Thriller" },
];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function Home() {
  const { isAuthenticated, user, openLoginModal, openRegisterModal } = useAuth();
  const navigate = useNavigate();
  const searchRef = useRef(null);

  const canBypassDisabled = user?.role === "owner" || Boolean(user?.can_bypass_disabled);

  const [pages, setPages] = useState([]);
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(8);
  const [shuffledGames] = useState(() => shuffle(GAME_CATALOG));
  const [playingCounts] = useState(() => {
    const m = {};
    GAME_CATALOG.forEach((g) => {
      m[g.name] = Math.floor(20 + Math.random() * 380);
    });
    return m;
  });
  const [statCounts] = useState(() => ({
    casino: Math.floor(28000 + Math.random() * 8000),
    sports: Math.floor(17000 + Math.random() * 6000),
  }));

  // fetch pages for gated navigation (same as before)
  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await api.get("/pages");
        if (!mounted) return;
        setPages(res.data?.data ?? []);
      } catch (e) {
        if (!mounted) return;
        setPages([]);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  const pageMap = useMemo(() => {
    const m = new Map();
    pages.forEach((p) => m.set(p.page_key, p));
    return m;
  }, [pages]);

  const isPageEnabled = (key) => {
    const p = pageMap.get(key);
    if (!p) return true;
    if (p.is_enabled) return true;
    return canBypassDisabled;
  };

  // keyboard shortcut Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filteredGames = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return shuffledGames;
    return shuffledGames.filter(
      (g) => g.display_name.toLowerCase().includes(q) || g.name.toLowerCase().includes(q)
    );
  }, [shuffledGames, search]);

  const visibleGames = useMemo(() => filteredGames.slice(0, visibleCount), [filteredGames, visibleCount]);

  // reset visibleCount when search changes
  useEffect(() => {
    setVisibleCount(8);
  }, [search]);

  const hasSocialLogin = true; // show decorative provider row to match reference image

  const casinoAllowed = isPageEnabled("games");
  const sportsAllowed = isPageEnabled("custom_bets");

  return (
    <div className={styles.home}>
      <div className={styles.pageInner}>
        {/* 1. Hero Banner */}
        <div
          className={styles.heroBanner}
          style={{
            backgroundImage: `url(${heroBanner})`,
          }}
        >
          <div className={styles.heroOverlay} aria-hidden="true" />
          <div className={styles.heroContent}>
            <h1 className={styles.heroTitle}>
              The Friend Group&apos;s
              <br />
              Private Casino
            </h1>

            {isAuthenticated ? (
              <>
                <div className={styles.heroBalancePill}>
                  <span className={styles.heroBalanceLabel}>Your balance</span>
                  <span className={styles.heroBalanceValue}>
                    {Number(user?.balance ?? 0).toFixed(2)} <span className={styles.heroCurrency}>$</span>
                  </span>
                </div>
                <div className={styles.heroActions}>
                  <Button
                    variant="primary"
                    size="md"
                    className={styles.heroCta}
                    onClick={() => {
                      if (!casinoAllowed) return;
                      navigate("/games");
                    }}
                    disabled={!casinoAllowed}
                  >
                    Start Playing
                  </Button>
                  <Button
                    variant="secondary"
                    size="md"
                    className={styles.heroSecondary}
                    onClick={() => navigate("/dashboard")}
                  >
                    Dashboard
                  </Button>
                </div>
              </>
            ) : (
              <>
                <Button variant="primary" size="md" className={styles.heroCta} onClick={openRegisterModal}>
                  Register
                </Button>
                <p className={styles.heroOrText}>Or Continue With</p>
                {hasSocialLogin ? (
                  <div className={styles.heroProviders} aria-label="Continue with provider">
                    <button type="button" className={styles.providerBtn} aria-label="Continue with Google">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                        />
                        <path
                          fill="currentColor"
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          opacity=".9"
                        />
                        <path
                          fill="currentColor"
                          d="M5.84 14.09A6.97 6.97 0 0 1 5.48 12c0-.72.13-1.43.36-2.09V7.07H2.18A11 11 0 0 0 1 12c0 1.78.43 3.45 1.18 4.93l3.66-2.84z"
                          opacity=".9"
                        />
                        <path
                          fill="currentColor"
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          opacity=".9"
                        />
                      </svg>
                    </button>
                    <button type="button" className={styles.providerBtn} aria-label="Continue with Facebook">
                      <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path
                          fill="currentColor"
                          d="M22 12a10 10 0 1 0-11.56 9.88v-6.99H7.9V12h2.54V9.8c0-2.5 1.49-3.89 3.77-3.89 1.09 0 2.23.2 2.23.2v2.46h-1.26c-1.24 0-1.63.77-1.63 1.56V12h2.78l-.44 2.89h-2.34v6.99A10 10 0 0 0 22 12z"
                        />
                      </svg>
                    </button>
                    <button type="button" className={styles.providerBtn} aria-label="Continue with Kick">
                      <span style={{ fontWeight: 900, fontSize: '14px', color: '#00e701', lineHeight: 1 }}>K</span>
                    </button>
                  </div>
                ) : null}
                <p className={styles.heroLoginHint}>
                  Already have an account?{" "}
                  <button type="button" className={styles.heroLoginLink} onClick={openLoginModal}>
                    Login
                  </button>
                </p>
              </>
            )}
          </div>
        </div>

        {/* 2. Stats Bar */}
        <div className={styles.statsBar}>
          <button
            type="button"
            className={styles.statCard}
            onClick={() => {
              if (!casinoAllowed) return;
              navigate("/games");
            }}
            aria-label="Go to Casino"
          >
            <span className={styles.statLeft}>
              <span className={styles.statIcon} aria-hidden="true">
                {/* game controller */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="2.5" y="8" width="19" height="9" rx="4.5" />
                  <path d="M7 11.5v3M5.5 13h3" />
                  <circle cx="15.2" cy="12.2" r="0.9" fill="currentColor" stroke="none" />
                  <circle cx="17.8" cy="13.8" r="0.9" fill="currentColor" stroke="none" />
                </svg>
              </span>
              <span className={styles.statLabel}>Casino</span>
            </span>
            <span className={styles.statRight}>
              <span className={styles.liveDot} aria-hidden="true" />
              <span className={styles.statNumber}>{statCounts.casino.toLocaleString()}</span>
              <span className={styles.statSuffix}>playing</span>
            </span>
          </button>

          <button
            type="button"
            className={styles.statCard}
            onClick={() => {
              const allowed = sportsAllowed;
              if (!allowed) return;
              navigate("/custom-bets");
            }}
            aria-label="Go to Sports"
          >
            <span className={styles.statLeft}>
              <span className={styles.statIcon} aria-hidden="true">
                {/* basketball */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="8.5" />
                  <path d="M12 3.5c2.8 3.2 2.8 13.8 0 17M3.5 12c3.2-2.8 13.8-2.8 17 0" />
                  <path d="M5.6 6.4c3.8 2 9 5.2 12.8 11.2M18.4 6.4C14.6 8.4 9.4 11.6 5.6 17.6" />
                </svg>
              </span>
              <span className={styles.statLabel}>Sports</span>
            </span>
            <span className={styles.statRight}>
              <span className={styles.liveDot} aria-hidden="true" />
              <span className={styles.statNumber}>{statCounts.sports.toLocaleString()}</span>
              <span className={styles.statSuffix}>betting</span>
            </span>
          </button>
        </div>

        {/* 3. Search Bar */}
        <div className={styles.searchWrap}>
          <label className={styles.searchBar} htmlFor="home-search">
            <span className={styles.searchIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="6.5" />
                <path d="M15.5 15.5L19 19" />
              </svg>
            </span>
            <input
              id="home-search"
              ref={searchRef}
              className={styles.searchInput}
              type="text"
              placeholder="Search Games"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
            <span className={styles.shortcutPill} aria-hidden="true">Cmd + K</span>
          </label>
        </div>

        {/* 4. Trending Games Section */}
        <section className={styles.trending} aria-label="Trending Games">
          <button type="button" className={styles.trendingHeader} onClick={() => navigate("/games")}>
            <span className={styles.trendingIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 17L9 11L13 15L21 7" />
                <path d="M14 7H21V14" />
              </svg>
            </span>
            <h2 className={styles.trendingTitle}>Trending Games</h2>
            <span className={styles.trendingChevron} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </span>
          </button>

          {visibleGames.length === 0 ? (
            <div className={styles.noResults}>No games found for “{search}”</div>
          ) : (
            <div className={styles.trendingGrid}>
              {visibleGames.map((game) => (
                <button
                  key={game.name}
                  type="button"
                  className={styles.gameCard}
                  onClick={() => navigate(`/games/${game.name}`)}
                  aria-label={`Play ${game.display_name}`}
                >
                  <span className={styles.thumbWrap}>
                    <img
                      className={styles.thumbImage}
                      src={game.poster || fallbackPoster}
                      alt={game.display_name}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.src = fallbackPoster;
                      }}
                    />
                    <span className={styles.thumbGradient}>
                      <span className={styles.thumbSubtitle}>{game.subtitle}</span>
                    </span>
                  </span>
                  <span className={styles.cardMeta}>
                    <span className={styles.liveDotSmall} aria-hidden="true" />
                    <span className={styles.cardMetaText}>{playingCounts[game.name]} playing</span>
                  </span>
                </button>
              ))}
            </div>
          )}

          {filteredGames.length > visibleGames.length && (
            <div className={styles.loadMoreWrap}>
              <Button
                variant="secondary"
                size="md"
                onClick={() => setVisibleCount((c) => Math.min(c + 8, filteredGames.length))}
              >
                Load More
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Home;
