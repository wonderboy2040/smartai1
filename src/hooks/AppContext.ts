import { createContext, useContext } from 'react';
import { useAppState } from './useAppState';

type AppState = ReturnType<typeof useAppState>;

export const AppContext = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppContext.Provider');
  return ctx;
}
