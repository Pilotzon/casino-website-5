// src/pages/games.jsx
import { useState, useEffect, useMemo, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { gamesAPI } from "../services/api";
import { useAuth } from "../context/AuthContext";

import Flip from "../components/games/Flip";
import Dice from "../components/games/Dice";
import Limbo from "../components/games/Limbo";
import Plinko from "../components/games/Plinko";
import Crash from "../components/games/Crash";
import Mines from "../components/games/Mines";
import Blackjack from "../components/games/Blackjack";
import Tower from "../components/games/Tower";
import RussianRoulette from "../components/games/RussianRoulette";
import Keno from "../components/games/Keno";
import Roulette from "../components/games/Roulette";
import Wheel from "../components/games/Wheel";
import Snakes from "../components/games/Snakes";
import RPS from "../components/games/RPS";

import styles from "./games.module.css";
import { LogoMark } from "../components/layout/Navigation";
import Modal from "../components/common/Modal";
import PageHero from "../components/common/PageHero";
import {
  IconGear,
  IconCaretLeft,
  IconCaretDown,
  IconShieldCheck,
  IconSparkle,
  IconSearch,
  IconSpeakerHigh,
  IconSpeakerLow,
  IconSpeakerNone,
  IconSpeakerX,
} from "../components/common/Icons";
import gamesHeroDice from "../assets/games-hero-dice.png";

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

// optional fallback (currently unused)
import fallbackPoster from "../assets/game-posters/fallback.png";


/* Per-game info for the "game info" block under the game box */
const GAME_INFO = {
  flip: {
    genres: ["Classic", "50 / 50"],
    description:
      "The timeless coin toss. Pick heads or tails, watch the coin flip in real time and double your money on a correct call.",
    howTo: [
      "Choose Heads or Tails in the sidebar.",
      "Enter your bet amount and press Bet.",
      "The coin flips; a correct call pays 1.98x.",
    ],
  },
  dice: {
    genres: ["Classic", "Multiplier"],
    description:
      "Roll the dice against your own target. Pick whether the roll lands under or over your number and set the risk yourself.",
    howTo: [
      "Select Under or Over and set a target number (2-98).",
      "The slider shows your win chance and multiplier.",
      "Press Roll — the result is instant.",
    ],
  },
  limbo: {
    genres: ["High risk", "Multiplier"],
    description:
      "How high can you go? Set a target multiplier and see if the round crashes above or below it.",
    howTo: [
      "Enter your bet and a target multiplier.",
      "Press Bet — a result multiplier is drawn.",
      "You win if the result is equal to or higher than your target.",
    ],
  },
  plinko: {
    genres: ["Classic", "Chance"],
    description:
      "Drop the ball from the top and watch it bounce through the pegs into a multiplier bucket at the bottom.",
    howTo: [
      "Choose a risk level and the number of rows.",
      "Enter your bet and press Bet to drop a ball.",
      "The bucket the ball lands in decides your payout.",
    ],
  },
  crash: {
    genres: ["High risk", "Multiplier"],
    description:
      "Ride the rising multiplier and cash out before the crash. Wait too long and you lose the round bet.",
    howTo: [
      "Place your bet while the counter is at 0.",
      "The multiplier climbs from 1.00x upward.",
      "Press Cash Out before it crashes to keep your win.",
    ],
  },
  mines: {
    genres: ["Strategy", "Grid"],
    description:
      "Uncover gems on a minefield. Every safe tile raises your multiplier — one mine ends the round.",
    howTo: [
      "Choose the number of mines and your bet.",
      "Click tiles to reveal gems and grow the multiplier.",
      "Cash out any time; hitting a mine loses the bet.",
    ],
  },
  roulette: {
    genres: ["Classic", "Table"],
    description:
      "Place chips on the classic European table — straight numbers, colours, dozens and more — then watch the wheel spin.",
    howTo: [
      "Select a chip value and click the table to bet.",
      "Use Undo/Clear to adjust your placements.",
      "Press Spin; winning bets pay per the table odds.",
    ],
  },
  blackjack: {
    genres: ["Cards", "Strategy"],
    description:
      "Beat the dealer's hand without going over 21. Hit, stand, double or split — the classic casino decisions.",
    howTo: [
      "Place a bet and press Deal.",
      "Hit for more cards or stand to hold.",
      "Double or split when the odds favour you; 21 pays 3:2.",
    ],
  },
  keno: {
    genres: ["Numbers", "Relaxed"],
    description:
      "Pick up to 10 numbers on the tile grid, then the draw reveals the lucky numbers — the more hits, the bigger the multiplier.",
    howTo: [
      "Select 1-10 numbers on the Tile Grid.",
      "The Multiplier Row shows each hit count's payout.",
      "Press Bet; drawn numbers light up on the grid.",
    ],
  },
  tower: {
    genres: ["Strategy", "Levels"],
    description:
      "Climb the tower level by level. Each floor hides one trap — pick the safe tile and bank your winnings at any height.",
    howTo: [
      "Set your bet and pick a difficulty (traps per row).",
      "Pick one of three tiles on each level.",
      "Cash out any time, or climb for bigger multipliers.",
    ],
  },
  russian_roulette: {
    genres: ["High risk", "Thriller"],
    description:
      "Six chambers, one bullet. Predict where it lands, or pass the gun and multiply the tension shot after shot.",
    howTo: [
      "Place your bet on where the shot lands.",
      "Each survived shot raises the multiplier.",
      "Cash out between shots — or take one more.",
    ],
  },
  wheel: {
    genres: ["Classic", "Multiplier"],
    description:
      "Spin the wheel of multipliers. Choose your risk profile — the wheel segments change with it.",
    howTo: [
      "Pick a risk level: low, medium or high.",
      "Place your bet and spin.",
      "The pointer segment's multiplier is your payout.",
    ],
  },
  snakes: {
    genres: ["Board", "Dice"],
    description:
      "The board game classic. Roll the dice, climb the ladders of fortune and avoid the snakes that drag you back down.",
    howTo: [
      "Pick a difficulty and place your bet.",
      "Roll the dice to move around the board.",
      "Snakes send you back; reach the finish to collect.",
    ],
  },
  rps: {
    genres: ["Classic", "Streak"],
    description:
      "Rock, Paper, Scissors against the house. Every win multiplies your potential payout — how long is your streak?",
    howTo: [
      "Place a bet to start a round.",
      "Pick Rock, Paper or Scissors each turn.",
      "Wins stack the multiplier; a loss ends the run.",
    ],
  },
};

/* Tags for game info header — Provably Fair etc (no wording) */
const GAME_META_TAGS = {
  flip: ["RTP: 98.00%", "50/50", "Provably Fair", "Casino Originals"],
  dice: ["RTP: 99.00%", "Multiplier", "Provably Fair", "Casino Originals", "Volatility Switch"],
  limbo: ["RTP: 99.00%", "High Risk", "Provably Fair", "Casino Originals"],
  plinko: ["RTP: 99.00%", "Pachinko", "Provably Fair", "Casino Originals", "Volatility Switch"],
  crash: ["RTP: 99.00%", "High Risk", "Provably Fair", "Casino Originals"],
  mines: ["RTP: 97.00%", "Strategy", "Provably Fair", "Casino Originals"],
  roulette: ["RTP: 97.30%", "Classic", "Table", "European"],
  blackjack: ["RTP: 99.50%", "Cards", "Provably Fair", "Classic"],
  keno: ["RTP: 96.00%", "Numbers", "Relaxed", "Casino Originals"],
  tower: ["RTP: 98.00%", "Strategy", "Levels", "Casino Originals"],
  russian_roulette: ["RTP: 96.00%", "High Risk", "Thriller", "Provably Fair"],
  wheel: ["RTP: 98.00%", "Multiplier", "Provably Fair", "Casino Originals"],
  snakes: ["RTP: 96.50%", "Board", "Dice", "Casino Originals"],
  rps: ["RTP: 97.00%", "Classic", "Streak", "Provably Fair"],
};

/* Fake statistics only — allowed to fake this section */
const GAME_STATS = {
  flip: { rtp: "98.00%", houseEdge: "2.00%", maxWin: "1.98x", volatility: "Low", wagered: "$12.4B", bets: "1.2B" },
  dice: { rtp: "99.00%", houseEdge: "1.00%", maxWin: "1000x", volatility: "Adjustable", wagered: "$28.1B", bets: "890M" },
  limbo: { rtp: "99.00%", houseEdge: "1.00%", maxWin: "1000000x", volatility: "High", wagered: "$18.7B", bets: "640M" },
  plinko: { rtp: "99.00%", houseEdge: "1.00%", maxWin: "10000x", volatility: "Switchable", wagered: "$42.3B", bets: "2.1B" },
  crash: { rtp: "99.00%", houseEdge: "1.00%", maxWin: "10000x", volatility: "High", wagered: "$36.9B", bets: "1.8B" },
  mines: { rtp: "97.00%", houseEdge: "3.00%", maxWin: "5000x", volatility: "Medium", wagered: "$22.5B", bets: "1.1B" },
  roulette: { rtp: "97.30%", houseEdge: "2.70%", maxWin: "35x", volatility: "Medium", wagered: "$15.2B", bets: "720M" },
  blackjack: { rtp: "99.50%", houseEdge: "0.50%", maxWin: "3:2", volatility: "Low", wagered: "$19.8B", bets: "950M" },
  keno: { rtp: "96.00%", houseEdge: "4.00%", maxWin: "1000x", volatility: "Medium", wagered: "$8.3B", bets: "410M" },
  tower: { rtp: "98.00%", houseEdge: "2.00%", maxWin: "10000x", volatility: "Adjustable", wagered: "$11.6B", bets: "560M" },
  russian_roulette: { rtp: "96.00%", houseEdge: "4.00%", maxWin: "5.80x", volatility: "High", wagered: "$6.2B", bets: "310M" },
  wheel: { rtp: "98.00%", houseEdge: "2.00%", maxWin: "1000x", volatility: "Switchable", wagered: "$14.7B", bets: "680M" },
  snakes: { rtp: "96.50%", houseEdge: "3.50%", maxWin: "500x", volatility: "Medium", wagered: "$7.9B", bets: "390M" },
  rps: { rtp: "97.00%", houseEdge: "3.00%", maxWin: "14x", volatility: "Medium", wagered: "$5.4B", bets: "280M" },
};

const GAME_CHALLENGES = {
  flip: ["Win 10 flips in a row", "Double your bet on a single flip", "Play 100 flips"],
  dice: ["Hit 990x multiplier", "Win 5 rolls over 90", "Roll under 10 and win"],
  limbo: ["Hit 100x target", "Survive 100 rounds", "Catch 1000x"],
  plinko: ["Drop 100 balls", "Hit 1000x multiplier", "Win on Expert risk"],
  crash: ["Cash out at 100x", "Ride to 50x and win", "Play 50 rounds"],
  mines: ["Clear 20 tiles without a mine", "Hit 50x on 5 mines", "Play 100 rounds"],
  roulette: ["Hit straight 35x", "Win 10 reds in a row", "Place 50 bets"],
  blackjack: ["Win with 21 three times", "Double down and win", "Win 10 hands"],
  keno: ["Hit 10/10 numbers", "Win 100x", "Play 50 draws"],
  tower: ["Reach the top floor", "Win 100x on Hard", "Climb 5 towers"],
  russian_roulette: ["Survive 5 shots", "Win on chamber 6", "Play 20 rounds"],
  wheel: ["Spin 100 times", "Hit 500x", "Win on high risk"],
  snakes: ["Reach finish in 5 rolls", "Climb 3 ladders", "Avoid snakes for 10 moves"],
  rps: ["Win 10 streak", "Beat the house 5 times", "Play 50 rounds"],
};

/* Detailed description per game for Description tab — real info, not faked (no wording) */
const GAME_LONG_DESC = {
  flip: {
    intro: "Flip is the original and provably-fair version of Coin Flip, developed in-house and playable only on our platform!",
    body: "Our Flip is built around a simple 50/50 mechanic where you pick heads or tails and watch the coin fly. With a 1.98x payout and 2% house edge, it is the purest casino duel.",
    what: "What is Flip? - The original online coin flip game",
    whatBody: "Flip was inspired by the classic coin toss and built on a provably-fair system that remains one of the most popular 50/50 games here — its instant result and clean odds set it apart.",
    howTitle: "How does Flip work?",
    howBody: "Flip is played by choosing Heads or Tails, entering your bet and pressing Bet. The coin animates in real time; a correct call pays 1.98x. You can use the side selector to switch sides instantly.",
  },
  dice: {
    intro: "Dice is the original and provably-fair dice game, developed in-house and playable only on our platform!",
    body: "Our Dice is built around a roll-under/over mechanic where you set your own target and see the multiplier update instantly. With up to 1000x and 99% RTP, it puts you in control of the risk.",
    what: "What is Dice? - The original online dice game",
    whatBody: "Dice was inspired by classic dice and built on a provably-fair system that remains one of the most popular multiplier games here — its adjustable volatility sets it apart.",
    howTitle: "How does Dice work?",
    howBody: "Dice is played by picking Under or Over and a target number between 2 and 98. The slider shows win chance and payout; press Roll and the result is instant.",
  },
  limbo: {
    intro: "Limbo is the original and provably-fair limbo game, developed in-house and playable only on our platform!",
    body: "Our Limbo is built around a target multiplier you set yourself, with a 1,000,000x max win and 99% RTP. Choose your risk and watch the result fly.",
    what: "What is Limbo? - The original online Limbo game",
    whatBody: "Limbo was inspired by crash-style multiplier games and built on a provably-fair system that remains one of the most thrilling high-risk games here.",
    howTitle: "How does Limbo work?",
    howBody: "Limbo is played by entering a target multiplier and pressing Bet. A result multiplier is drawn; you win if it meets or exceeds your target.",
  },
  plinko: {
    intro: "Plinko is the original and provably-fair version of Plinko, developed in-house and playable only on our platform!",
    body: "Our Plinko is built around a pin-pyramid drop mechanic where every ball can land a multiplier payout, with 4 risk levels available. Thanks to a 10,000x max win, a 1% house edge and a 99% RTP, Plinko goes further than most Plinko games.",
    what: "What is Plinko? - The original online Plinko game",
    whatBody: "Plinko was inspired by the Japanese Pachinko arcade game and the Plinko board from the TV game show \"The Price is Right\". Plinko is the original, built on a provably-fair system that remains one of the most popular casino-style games here — and its 10,000x ceiling sets it apart from other Plinko games online.",
    howTitle: "How does Plinko work?",
    howBody: "Plinko is played by dropping a ball into a pin pyramid, which then bounces into a multiplier pot. The centre pots offer the lowest payouts, with the higher wins sitting on the edge of the board. There are 2 settings you can adjust that control how the game behaves. The Risk Level can be set to Easy, Medium, Hard, or Expert, with higher settings increasing the game's volatility. It does this by widening the edge multipliers and narrowing the middle pots. Rows is another setting available, and you can choose between 8 and 16 for each round. The more rows you select, the higher the potential multipliers at the edges.",
  },
  crash: {
    intro: "Crash is the original and provably-fair crash game, developed in-house and playable only on our platform!",
    body: "Our Crash is built around a rising multiplier that can crash at any moment, with a 10,000x max win and 99% RTP. Time your cash out perfectly.",
    what: "What is Crash? - The original online crash game",
    whatBody: "Crash was inspired by classic multiplier curves and built on a provably-fair system that remains one of the most played high-risk games here.",
    howTitle: "How does Crash work?",
    howBody: "Crash is played by placing a bet before the curve starts at 1.00x. The multiplier climbs until it crashes; press Cash Out before it crashes to lock your win.",
  },
  mines: {
    intro: "Mines is the original and provably-fair mines game, developed in-house and playable only on our platform!",
    body: "Our Mines is built around a minefield where every safe gem raises your multiplier. With adjustable mines and up to 5000x, the risk is yours to choose.",
    what: "What is Mines? - The original online mines game",
    whatBody: "Mines was inspired by Minesweeper and built on a provably-fair system that remains one of the most strategic games here.",
    howTitle: "How does Mines work?",
    howBody: "Mines is played by choosing a mine count and bet, then clicking tiles to reveal gems. Each gem grows the multiplier; cash out any time before hitting a mine.",
  },
  roulette: {
    intro: "Roulette is the original European roulette, developed in-house and playable only on our platform!",
    body: "Our Roulette is built around a classic European wheel with straight numbers, colours and dozens, with 35x max on a single number.",
    what: "What is Roulette? - The original online roulette game",
    whatBody: "Roulette was inspired by the timeless casino table and built on a provably-fair system that remains a classic here.",
    howTitle: "How does Roulette work?",
    howBody: "Roulette is played by placing chips on the table — numbers, colours, dozens — then pressing Spin. Winning bets pay per the table odds.",
  },
  blackjack: {
    intro: "Blackjack is the original blackjack table, developed in-house and playable only on our platform!",
    body: "Our Blackjack is built around classic 21 rules with hit, stand, double and split, with 3:2 on natural blackjack and 99.5% RTP.",
    what: "What is Blackjack? - The original online blackjack game",
    whatBody: "Blackjack was inspired by the classic 21 card game and built on a provably-fair system that remains a favourite for strategy players here.",
    howTitle: "How does Blackjack work?",
    howBody: "Blackjack is played by placing a bet and pressing Deal. Hit for more cards or stand to hold; double or split when the odds favour you.",
  },
  keno: {
    intro: "Keno is the original and provably-fair keno game, developed in-house and playable only on our platform!",
    body: "Our Keno is built around a tile grid where you pick up to 10 numbers and watch the draw reveal the hits, with up to 1000x.",
    what: "What is Keno? - The original online Keno game",
    whatBody: "Keno was inspired by classic lottery draws and built on a provably-fair system that remains a relaxed favourite here.",
    howTitle: "How does Keno work?",
    howBody: "Keno is played by selecting 1-10 numbers on the grid. The multiplier row shows each hit count's payout; press Bet and drawn numbers light up.",
  },
  tower: {
    intro: "Tower is the original and provably-fair tower game, developed in-house and playable only on our platform!",
    body: "Our Tower is built around a multi-level climb where each floor hides one trap, with up to 10,000x if you reach the top.",
    what: "What is Tower? - The original online tower game",
    whatBody: "Tower was inspired by classic risk ladders and built on a provably-fair system that remains a strategic climb here.",
    howTitle: "How does Tower work?",
    howBody: "Tower is played by setting a bet and difficulty, then picking one of three tiles on each level. Cash out any time or climb for bigger multipliers.",
  },
  russian_roulette: {
    intro: "Russian Roulette is the original thriller, developed in-house and playable only on our platform!",
    body: "Our Russian Roulette is built around six chambers and one bullet, with up to 5.80x if you keep pulling the trigger.",
    what: "What is Russian Roulette? - The original online thriller",
    whatBody: "Russian Roulette was inspired by the classic tense chance game and built on a provably-fair system that remains the most suspenseful game here.",
    howTitle: "How does Russian Roulette work?",
    howBody: "Russian Roulette is played by placing a bet on where the shot lands. Each survived pull raises the multiplier; cash out between shots or take one more.",
  },
  wheel: {
    intro: "Wheel is the original and provably-fair wheel game, developed in-house and playable only on our platform!",
    body: "Our Wheel is built around a spinning wheel of multipliers where your risk choice reshapes the segments, with up to 1000x.",
    what: "What is Wheel? - The original online wheel game",
    whatBody: "Wheel was inspired by classic wheels of fortune and built on a provably-fair system that remains a colourful favourite here.",
    howTitle: "How does Wheel work?",
    howBody: "Wheel is played by picking low, medium or high risk, placing your bet and spinning. The pointer segment's multiplier is your payout.",
  },
  snakes: {
    intro: "Snakes & Ladders is the original board game, developed in-house and playable only on our platform!",
    body: "Our Snakes is built around a dice roll board where ladders boost you and snakes drag you back, with up to 500x.",
    what: "What is Snakes? - The original online board game",
    whatBody: "Snakes was inspired by the timeless board game and built on a provably-fair system that remains a playful race here.",
    howTitle: "How does Snakes work?",
    howBody: "Snakes is played by picking a difficulty and bet, then rolling the dice to move. Reach the finish to collect; snakes send you back.",
  },
  rps: {
    intro: "Rock Paper Scissors is the original and provably-fair RPS game, developed in-house and playable only on our platform!",
    body: "Our RPS is built around streak multipliers where every win stacks the potential payout, with up to 14x on a long run.",
    what: "What is RPS? - The original online RPS game",
    whatBody: "RPS was inspired by the classic hand game and built on a provably-fair system that remains a streak challenge here.",
    howTitle: "How does RPS work?",
    howBody: "RPS is played by placing a bet and picking Rock, Paper or Scissors each turn. Wins stack the multiplier; a loss ends the run.",
  },
};

const SOUND_ENABLED_LS_KEY = "games:soundEnabled";
const SOUND_VOLUME_LS_KEY = "games:soundVolume";

function clamp01(n) {
  const x = Number(n);
  if (Number.isNaN(x)) return 1;
  return Math.max(0, Math.min(1, x));
}

function Games() {
  // Holders of the "bypass disabled games/pages" permission (owner included)
  // keep playing games an admin switched off, so the grid must not label them
  // "Unavailable" for them.
  const { user } = useAuth();
  const canBypassDisabled = user?.role === "owner" || Boolean(user?.can_bypass_disabled);
  const { gameName } = useParams();
  const navigate = useNavigate();
  const [games, setGames] = useState([]);
  const [loading, setLoading] = useState(true);

  // Sound settings (persisted)
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [soundVolume, setSoundVolume] = useState(0.8);

  // game toolbar: settings popover + fairness modal
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fairnessOpen, setFairnessOpen] = useState(false);

  // Games list page: search + playing counts + sort
  const [search, setSearch] = useState("");
  const searchRef = useRef(null);
  const [sortBy, setSortBy] = useState("popular");
  const [infoTab, setInfoTab] = useState("description");
  const [gameInfoCollapsed, setGameInfoCollapsed] = useState(false);
  const [statsSubTab, setStatsSubTab] = useState("statistics");
  const [playingCounts] = useState(() => {
    const m = {};
    const names = ["flip","dice","limbo","plinko","crash","mines","roulette","blackjack","keno","tower","russian_roulette","wheel","snakes","rps"];
    names.forEach((n) => {
      m[n] = Math.floor(120 + Math.random() * 1800);
    });
    return m;
  });



  // close the settings popover on any outside click
  useEffect(() => {
    if (!settingsOpen) return undefined;
    const onDown = (e) => {
      const wrap = document.querySelector("[data-settings-wrap]");
      if (!wrap || !wrap.contains(e.target)) setSettingsOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [settingsOpen]);

  useEffect(() => {
    try {
      const rawEnabled = localStorage.getItem(SOUND_ENABLED_LS_KEY);
      const rawVol = localStorage.getItem(SOUND_VOLUME_LS_KEY);

      setSoundEnabled(rawEnabled === null ? true : rawEnabled === "true");
      setSoundVolume(rawVol === null ? 0.8 : clamp01(parseFloat(rawVol)));
    } catch {
      setSoundEnabled(true);
      setSoundVolume(0.8);
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SOUND_ENABLED_LS_KEY, String(soundEnabled));
      localStorage.setItem(SOUND_VOLUME_LS_KEY, String(soundVolume));
    } catch {
      // ignore
    }
  }, [soundEnabled, soundVolume]);

  // every game page opens at the top (also when switching games via
  // "You might also like" or the side rail)
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const id = requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
    setInfoTab("description");
    setGameInfoCollapsed(false);
    setStatsSubTab("statistics");
    return () => cancelAnimationFrame(id);
  }, [gameName]);

  useEffect(() => {
    fetchGames();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cmd+K for Games search (only when on list page)
  useEffect(() => {
    if (gameName) return;
    const handler = (e) => {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [gameName]);

  const fetchGames = async () => {
    try {
      const response = await gamesAPI.getAll();
      setGames(response.data.data);
    } catch (error) {
      console.error("Failed to fetch games:", error);
    } finally {
      setLoading(false);
    }
  };

  const gameComponents = useMemo(
    () => ({
      flip: Flip,
      dice: Dice,
      limbo: Limbo,
      plinko: Plinko,
      crash: Crash,
      mines: Mines,
      roulette: Roulette,
      blackjack: Blackjack,
      keno: Keno,
      tower: Tower,
      russian_roulette: RussianRoulette,
      wheel: Wheel,
      snakes: Snakes,
      rps: RPS,
    }),
    []
  );

  const implementedGames = useMemo(
    () =>
      new Set([
        "flip",
        "dice",
        "limbo",
        "plinko",
        "crash",
        "mines",
        "roulette",
        "blackjack",
        "keno",
        "tower",
        "russian_roulette",
        "wheel",
        "snakes",
        "rps",
      ]),
    []
  );

  const GameComponent = gameName && gameComponents[gameName];

  const handleSurpriseMe = () => {
    const pool = games.filter((g) => implementedGames.has(g.name) && Boolean(g.is_enabled) && !!getGamePoster(g.name));
    const list = pool.length ? pool : games.filter((g) => !!getGamePoster(g.name));
    if (!list.length) return;
    const pick = list[Math.floor(Math.random() * list.length)];
    navigate(`/games/${pick.name}`);
  };

  // 6 random games for the "You might also like" strip below the box.
  // TOP-LEVEL hook — computing it conditionally broke React's rules of
  // hooks and blanked every game page.
  const suggestions = useMemo(() => {
    const pool = games.filter((g) => g.name !== gameName);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [games, gameName]);

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading games...</p>
      </div>
    );
  }

  if (GameComponent) {
    const gameRow = games.find((g) => g.name === gameName);
    return (
      <>
      <div
        className={styles.gameContainer}
        data-game={gameName || ""}
        data-sound={soundEnabled ? "on" : "off"}
        data-sound-enabled={soundEnabled ? "true" : "false"}
      >
        <GameComponent soundEnabled={soundEnabled} soundVolume={soundVolume} gameRow={gameRow} />
      </div>

      {/* Compact toolbar UNDER the box: [settings | back] · logo · [Fairness] */}
      <div className={styles.gameToolbar}>
        <div className={styles.gameToolbarLeft}>
          <div className={styles.settingsWrap} data-settings-wrap="true">
            <button
              type="button"
              className={styles.toolBtn}
              data-tip="Settings"
              aria-label="Settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <IconGear />
            </button>

            {settingsOpen && (
              <div className={styles.settingsMenu}>
                <span className={styles.volumeIcon} aria-hidden="true">
                  <SpeakerIcon muted={!soundEnabled} level={soundVolume} />
                </span>
                <input
                  className={styles.volumeSlider}
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={soundVolume}
                  onChange={(e) => {
                    const v = clamp01(e.target.value);
                    setSoundVolume(v);
                    setSoundEnabled(v > 0);
                  }}
                  aria-label="Volume"
                  style={{ "--vol-fill": `${Math.round(soundVolume * 100)}%` }}
                />
                <span className={styles.volumeValue} aria-live="polite">
                  {soundEnabled ? `${Math.round(soundVolume * 100)}%` : "Off"}
                </span>
              </div>
            )}
          </div>

          <button
            type="button"
            className={styles.toolBtn}
            data-tip="Back to Games"
            aria-label="Back to Games"
            onClick={() => navigate("/games")}
          >
            <IconCaretLeft />
          </button>
        </div>

        <LogoMark className={styles.gameToolbarLogo} />

        <button type="button" className={styles.fairnessBtn} onClick={() => setFairnessOpen(true)}>
          Fairness
        </button>
      </div>

      <Modal
        isOpen={fairnessOpen}
        onClose={() => setFairnessOpen(false)}
        title="Fairness"
        size="md"
        icon={<IconShieldCheck />}
        description="Every game on this platform is provably fair. Outcomes are produced by a cryptographically secure random number generator (HMAC-SHA256), never by anything you can influence after placing a bet."
        footer={<a href="/fairness" onClick={(e) => e.preventDefault()}>Learn more</a>}
      >
        <div className={styles.fairnessBody}>
          <p>
            Before each round the server commits to the result seed by
            publishing its hash; after the round the seed itself is revealed,
            so anyone can recompute the outcome and verify it was never
            altered. The house has no way to change a result once committed.
          </p>
          <p>
            All balances are virtual credits with no real-world value — this
            platform exists purely for entertainment between friends.
          </p>
        </div>
      </Modal>

      {/* Game info — EXACTLY like image-3.png: provider header + title stats + pill menu + poster/tags/content */}
      {(() => {
        const gi = GAME_INFO[gameName] || {
          genres: ["Casino"],
          description: "A classic casino game.",
          howTo: [],
        };
        const dn = games.find((g) => g.name === gameName)?.display_name || gameName;
        const tags = GAME_META_TAGS[gameName] || gi.genres || ["Casino Originals"];
        const stats = GAME_STATS[gameName] || { rtp: "99.00%", houseEdge: "1.00%", maxWin: "1000x", volatility: "Medium", wagered: "$10.0B", bets: "500M" };
        const longDesc = GAME_LONG_DESC[gameName] || {
          intro: gi.description,
          body: "",
          what: `What is ${dn}? - The original online ${dn} game`,
          whatBody: gi.description,
          howTitle: "How does it work?",
          howBody: gi.howTo.join(" "),
        };
        const challenges = GAME_CHALLENGES[gameName] || ["Play 10 rounds", "Win 5 in a row", "Hit max multiplier"];
        const playing = playingCounts[gameName] ? `${(playingCounts[gameName] / 1000).toFixed(2)}K` : "1.15K";
        const saves = "135.47K";
        return (
          <section className={`${styles.gameInfo} ${gameInfoCollapsed ? styles.gameInfoCollapsed : ""}`} aria-label="Game information">
            {/* Provider header: Casino Originals + total playing + Surprise me (instead of Follow) */}
            <div className={styles.gameInfoProviderRow}>
              <div className={styles.providerLeft}>
                <div className={styles.providerLogoBox} aria-hidden="true">
                  <span className={styles.providerLogoText}>Casino</span>
                </div>
                <div className={styles.providerText}>
                  <div className={styles.providerName}>Casino Originals</div>
                  <div className={styles.providerFollowers}>{`${(Object.values(playingCounts).reduce((a,b)=>a+b,0)/1000).toFixed(1)}K Playing`}</div>
                </div>
              </div>
              <button type="button" className={styles.surpriseBtn} onClick={handleSurpriseMe}>
                <IconSparkle size={18} />
                Surprise me
              </button>
            </div>

            {/* Game title row + live stats — click anywhere to collapse */}
            <div
              className={styles.gameInfoHeaderRow}
              onClick={() => setGameInfoCollapsed((v) => !v)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setGameInfoCollapsed((v)=>!v); } }}
              aria-expanded={!gameInfoCollapsed}
            >
              <h2 className={styles.gameInfoName}>{dn}</h2>
              <div className={styles.gameInfoStatsRow}>
                <span className={styles.liveDotSmall} aria-hidden="true" />
                <span className={styles.statValue}><span className={styles.statValueNumber}>{playing}</span><span className={styles.statValueLabel}> Playing</span></span>
                <span className={styles.statDivider} aria-hidden="true">·</span>
                <span className={styles.statValue}><span className={styles.statValueNumber}>{saves}</span><span className={styles.statValueLabel}> Saves</span></span>
                <span className={styles.statDivider} aria-hidden="true">·</span>
                <span className={styles.insightsBtn} aria-hidden="true">
                  Game Insights
                  <IconCaretDown size={12} />
                </span>
              </div>
            </div>

            {/* Pill menu EXACTLY like manual/auto mode switcher */}
            <div className={styles.gameInfoTabs}>
              <div className={styles.pillToggle}>
                <button type="button" className={`${styles.pillBtn} ${infoTab === "statistics" ? styles.pillActive : ""}`} onClick={() => setInfoTab("statistics")}>
                  Game Statistics
                </button>
                <button type="button" className={`${styles.pillBtn} ${infoTab === "description" ? styles.pillActive : ""}`} onClick={() => setInfoTab("description")}>
                  Description
                </button>
                <button type="button" className={`${styles.pillBtn} ${infoTab === "challenges" ? styles.pillActive : ""}`} onClick={() => setInfoTab("challenges")}>
                  Challenges
                </button>
              </div>
            </div>

            {/* Content: poster left + details right */}
            <div className={styles.gameInfoContent}>
              <img className={styles.gameInfoPoster} src={getGamePoster(gameName) || fallbackPoster} alt={`${dn} poster`} />
              <div className={styles.gameInfoDetails}>
                <div className={styles.gameInfoTags}>
                  {tags.map((t) => (
                    <span key={t} className={styles.metaTag}>{t}</span>
                  ))}
                </div>

                {infoTab === "description" && (
                  <div className={styles.descContent}>
                    <p className={styles.gameInfoDesc}>{longDesc.intro}</p>
                    <p className={styles.gameInfoDesc}>{longDesc.body}</p>
                    <h3 className={styles.descHeading}>{longDesc.what}</h3>
                    <p className={styles.gameInfoDesc}>{longDesc.whatBody}</p>
                    <h3 className={styles.descHeading}>{longDesc.howTitle}</h3>
                    <p className={styles.gameInfoDesc}>{longDesc.howBody}</p>
                    {gi.howTo && gi.howTo.length > 0 && (
                      <ol className={styles.descList}>
                        {gi.howTo.map((s) => (
                          <li key={s}>{s}</li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                {infoTab === "statistics" && (
                  <div className={styles.statsContent}>
                    <div className={styles.statsSubTabs}>
                      <button type="button" className={`${styles.statsSubBtn} ${statsSubTab === "statistics" ? styles.statsSubBtnActive : ""}`} onClick={() => setStatsSubTab("statistics")}>Statistics</button>
                      <button type="button" className={`${styles.statsSubBtn} ${statsSubTab === "bigwins" ? styles.statsSubBtnActive : ""}`} onClick={() => setStatsSubTab("bigwins")}>Big Wins</button>
                      <button type="button" className={`${styles.statsSubBtn} ${statsSubTab === "luckywins" ? styles.statsSubBtnActive : ""}`} onClick={() => setStatsSubTab("luckywins")}>Lucky Wins</button>
                    </div>
                    {statsSubTab === "statistics" ? (
                      <div className={styles.statsTableWrap}>
                        <table className={styles.statsTable}>
                          <thead>
                            <tr>
                              <th>Period</th>
                              <th>RTP</th>
                              <th>Total Wagered</th>
                              <th>Total Bets</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(() => {
                              const baseRtp = parseFloat(String(stats.rtp).replace("%", "")) || 97;
                              const fmtRtp = (v) => `${v.toFixed(2)}%`;
                              const parseWagered = (s) => {
                                const n = parseFloat(String(s).replace(/[$,]/g, ""));
                                if (String(s).includes("B")) return n * 1e9;
                                if (String(s).includes("M")) return n * 1e6;
                                return n;
                              };
                              const parseBets = (s) => {
                                const n = parseFloat(String(s).replace(/[,]/g, ""));
                                if (String(s).includes("B")) return n * 1e9;
                                if (String(s).includes("M")) return n * 1e6;
                                return n;
                              };
                              const fmtMoney = (n) => {
                                if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
                                if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
                                if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
                                return `$${n}`;
                              };
                              const fmtBets = (n) => {
                                if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
                                if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
                                if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
                                return `${n}`;
                              };
                              const totalW = parseWagered(stats.wagered);
                              const totalB = parseBets(stats.bets);
                              const rows = [
                                { period: "Last 24 hours", rtp: fmtRtp(baseRtp + 0.12), wagered: fmtMoney(totalW * 0.018), bets: fmtBets(totalB * 0.019) },
                                { period: "Last 7 days", rtp: fmtRtp(baseRtp + 0.05), wagered: fmtMoney(totalW * 0.095), bets: fmtBets(totalB * 0.098) },
                                { period: "Last 28 days", rtp: fmtRtp(baseRtp - 0.02), wagered: fmtMoney(totalW * 0.31), bets: fmtBets(totalB * 0.32) },
                                { period: "All Time", rtp: stats.rtp, wagered: stats.wagered, bets: stats.bets },
                              ];
                              return rows.map((r) => (
                                <tr key={r.period}>
                                  <td>{r.period}</td>
                                  <td>{r.rtp}</td>
                                  <td>{r.wagered}</td>
                                  <td>{r.bets}</td>
                                </tr>
                              ));
                            })()}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className={styles.statsEmpty}>No {statsSubTab === "bigwins" ? "big" : "lucky"} wins yet — play to see your biggest wins here.</div>
                    )}
                    <p className={styles.mutedNote}>Statistics are updated in real time and may vary.</p>
                  </div>
                )}

                {infoTab === "challenges" && (
                  <div className={styles.challengesContent}>
                    <p className={styles.gameInfoDesc}>Complete challenges to earn rewards and show your skill.</p>
                    <ul className={styles.challengesList}>
                      {challenges.map((c) => (
                        <li key={c} className={styles.challengeItem}>
                          <span className={styles.challengeBullet} aria-hidden="true" />
                          <span>{c}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          </section>
        );
      })()}

      {/* You might also like — 6 random games; a card opens THAT game,
          the header text goes to the games page (0.98 press feedback) */}
      <section className={styles.alsoLike} aria-label="You might also like">
        <button
          type="button"
          className={`${styles.alsoLikeTitle} pressable`}
          onClick={() => navigate("/games")}
        >
          You might also like
        </button>
        <div className={styles.alsoLikeRow}>
          {suggestions.map((g) => (
            <button
              key={g.name}
              type="button"
              className={`${styles.alsoLikeCard} pressable`}
              onClick={() => {
                navigate(`/games/${g.name}`);
                window.scrollTo({ top: 0, left: 0, behavior: "auto" });
                requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "auto" }));
              }}
            >
              <img
                className={styles.alsoLikePoster}
                src={getGamePoster(g.name) || fallbackPoster}
                alt=""
                loading="lazy"
              />
              <span className={styles.alsoLikeName}>{g.display_name}</span>
            </button>
          ))}
        </div>
      </section>
      </>
    );
  }

  // ---- Games list page (Casino Originals style) ----
  const totalPlaying = Object.values(playingCounts).reduce((a, b) => a + b, 0);
  const totalPlayingK = `${(totalPlaying / 1000).toFixed(2)}K`;
  const heroStats = [
    { dot: true, value: totalPlayingK, label: "Playing" },
    { value: String(games.filter((g) => !!getGamePoster(g.name)).length), label: "Games" },
    { value: "187.93K", label: "Followers" },
    { value: "$372.31B", label: "Wagered" },
    { value: "375.78B", label: "Bets" },
  ];

  const filteredGames = games
    .filter((game) => !!getGamePoster(game.name))
    .filter((game) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return game.display_name.toLowerCase().includes(q) || game.name.toLowerCase().includes(q);
    });

  const sortedGames = [...filteredGames].sort((a, b) => {
    if (sortBy === "popular") {
      return (playingCounts[b.name] || 0) - (playingCounts[a.name] || 0);
    }
    if (sortBy === "name_asc") {
      return String(a.name).localeCompare(String(b.name));
    }
    if (sortBy === "name_desc") {
      return String(b.name).localeCompare(String(a.name));
    }
    return 0;
  });

  return (
    <div className={styles.games}>
      <div className={styles.container}>
        <PageHero
          title="Casino Games"
          stats={heroStats}
          description="The best Friend Group casino games offer big wins and exciting bonus features! Play exclusive games like Plinko, Crash, Mines, Hilo and casino classics like Poker, Blackjack, and Roulette."
          buttonText="Surprise me"
          buttonIcon={
            <IconSparkle size={18} />
          }
          onButtonClick={handleSurpriseMe}
          image={gamesHeroDice}
          imageAlt="Dice"
          logo={<span style={{ fontWeight: 900 }}>Casino</span>}
        />

        <div className={styles.searchFilterRow}>
          <div className={styles.searchWrap}>
            <label className={styles.searchBar} htmlFor="games-search">
              <span className={styles.searchIcon} aria-hidden="true">
                <IconSearch />
              </span>
              <input
                id="games-search"
                ref={searchRef}
                className={styles.searchInput}
                type="text"
                placeholder="Search games"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                autoComplete="off"
              />
              <span className={styles.shortcutPill} aria-hidden="true">Cmd + K</span>
            </label>
          </div>

          <div className={styles.filterBar}>
            <div className={styles.filterRight}>
              <select
                className={styles.sortSelect}
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                aria-label="Sort games"
              >
                <option value="popular">Popular</option>
                <option value="name_asc">Name A–Z</option>
                <option value="name_desc">Name Z–A</option>
              </select>
            </div>
          </div>
        </div>

        <div className={styles.grid}>
          {sortedGames.map((game) => {
              const isImplemented = implementedGames.has(game.name);
              const isUnavailable =
                !isImplemented || (!Boolean(game.is_enabled) && !canBypassDisabled);
              const count = playingCounts[game.name] ?? Math.floor(100 + Math.random() * 1500);
              return (
                <button
                  key={game.id}
                  type="button"
                  className={`${styles.poster} ${
                    isUnavailable ? styles.unavailable : styles.available
                  }`}
                  onClick={() => {
                    navigate(`/games/${game.name}`);
                  }}
                  aria-disabled={isUnavailable}
                  title={
                    !isImplemented
                      ? "Unavailable"
                      : !game.is_enabled && !canBypassDisabled
                      ? "Disabled"
                      : game.display_name
                  }
                >
                  <span className={styles.posterMedia}>
                    <img
                      className={styles.posterImage}
                      src={getGamePoster(game.name)}
                      alt={game.display_name}
                      loading="lazy"
                    />

                    {isUnavailable && (
                      <span className={styles.unavailableOverlay} aria-hidden="true">
                        Unavailable
                      </span>
                    )}
                  </span>
                  <span className={styles.posterMeta}>
                    <span className={styles.liveDotSmall} aria-hidden="true" />
                    <span className={styles.posterMetaText}><span className={styles.posterMetaNumber}>{count.toLocaleString()}</span> <span className={styles.posterMetaLabel}>playing</span></span>
                  </span>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}

/* Filled speaker (common/Icons.jsx): muted -> ×, loud -> 2 waves, quiet ->
   1 wave, zero -> none */
function SpeakerIcon({ muted = false, level = 1 }) {
  const Icon = muted
    ? IconSpeakerX
    : level > 0.5
      ? IconSpeakerHigh
      : level > 0
        ? IconSpeakerLow
        : IconSpeakerNone;
  return <Icon size={16} />;
}

function getGamePoster(name) {
  const posters = {
    flip: flipPoster,
    dice: dicePoster,
    limbo: limboPoster,
    plinko: plinkoPoster,
    crash: crashPoster,
    mines: minesPoster,
    roulette: roulettePoster,
    blackjack: blackjackPoster,
    keno: kenoPoster,
    tower: towerPoster,
    russian_roulette: russianRoulettePoster,
    wheel: wheelPoster,
    snakes: snakesPoster,
    rps: rpsPoster,
    fallback: fallbackPoster,
  };

  return posters[name];
}

export default Games;
