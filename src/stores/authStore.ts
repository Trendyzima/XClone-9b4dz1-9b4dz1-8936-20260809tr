import { create } from 'zustand';
import { AuthUser } from '@/types/app-types';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  authError: string | null;
  login: (user: AuthUser) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
  setAuthError: (error: string) => void;
  clearAuthError: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  authError: null,
  login: (user) => set({ user, loading: false, authError: null }),
  logout: () => set({ user: null, loading: false }),
  setLoading: (loading) => set({ loading }),
  setAuthError: (authError) => set({ authError }),
  clearAuthError: () => set({ authError: null }),
}));
