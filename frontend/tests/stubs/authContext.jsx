import { useMemo } from 'react';

/** Test double for `src/context/AuthContext.jsx` (logged in, 100 credits). */
export const __auth = {
  user: { id: 1, username: 'tester', role: 'user', balance: 100 },
  isAuthenticated: true,
};

const updateBalance = (balance) => { __auth.user.balance = balance; };

export const useAuth = () => useMemo(() => ({
  user: __auth.user,
  token: 'test-token',
  isAuthenticated: __auth.isAuthenticated,
  updateBalance,
  // identity is stable: these values sit in dependency arrays of the game
}), []);

export const AuthProvider = ({ children }) => children;
