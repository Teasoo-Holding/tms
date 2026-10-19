import { useSyncExternalStore } from 'react';
import { auth } from './api/client';

export function useAuth() {
  return useSyncExternalStore(auth.subscribe, () => auth.user);
}
export const useIsAdmin = () => useAuth()?.role === 'ADMIN';
