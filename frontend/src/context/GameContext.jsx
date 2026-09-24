import { createContext, useContext, useState } from 'react';

const GameContext = createContext(null);

export const useGame = () => {
  const context = useContext(GameContext);
  if (!context) {
    throw new Error('useGame must be used within GameProvider');
  }
  return context;
};

export const GameProvider = ({ children }) => {
  const [currentGame, setCurrentGame] = useState(null);
  const [gameHistory, setGameHistory] = useState([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [autobetActive, setAutobetActive] = useState(false);
  const [autobetConfig, setAutobetConfig] = useState({
    numberOfBets: 0,
    onWinIncrease: 0,
    onLossIncrease: 0,
    stopOnProfit: null,
    stopOnLoss: null
  });

  const addToHistory = (result) => {
    setGameHistory((prev) => [result, ...prev].slice(0, 50)); // Keep last 50
  };

  const clearHistory = () => {
    setGameHistory([]);
  };

  const startAutobet = (config) => {
    setAutobetConfig(config);
    setAutobetActive(true);
  };

  const stopAutobet = () => {
    setAutobetActive(false);
  };

  const resetGame = () => {
    setCurrentGame(null);
    setIsPlaying(false);
    setAutobetActive(false);
  };

  const value = {
    currentGame,
    setCurrentGame,
    gameHistory,
    addToHistory,
    clearHistory,
    isPlaying,
    setIsPlaying,
    autobetActive,
    autobetConfig,
    startAutobet,
    stopAutobet,
    resetGame
  };

  return (
    <GameContext.Provider value={value}>
      {children}
    </GameContext.Provider>
  );
};