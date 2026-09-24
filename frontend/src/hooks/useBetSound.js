import useGameAudio from "./useGameAudio";
import betMp3 from "../assets/Bet.mp3";

/**
 * Global "bet click" SFX.
 * Use in any game: const betSfx = useBetSound({ soundEnabled, soundVolume });
 * Then call: betSfx.playBet();
 */
export default function useBetSound({ soundEnabled = true, soundVolume = 0.8 } = {}) {
  const sfx = useGameAudio(
    { bet: betMp3 },
    { enabled: soundEnabled, volume: soundVolume }
  );

  return {
    playBet: (opts = {}) => sfx.play("bet", { volume: 1, ...opts }),
  };
}