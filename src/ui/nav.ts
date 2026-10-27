// Screen navigation with browser history, so the phone's back button
// returns to the previous screen instead of leaving the app.

import { createStore } from '../lib/store';

export type Screen =
  | { name: 'main' }
  | { name: 'library' }
  | { name: 'lists' }
  | { name: 'list'; id: string }
  | { name: 'metronome' }
  | { name: 'offline' }
  | { name: 'help' };

export const nav = createStore<Screen[]>([{ name: 'main' }]);

export const screen = (): Screen => {
  const s = nav.get();
  return s[s.length - 1];
};

export function go(s: Screen): void {
  nav.set((st) => [...st, s]);
  history.pushState({ depth: nav.get().length }, '');
}

export function back(): void {
  if (nav.get().length > 1) history.back();
}

/** Back to the main screen (e.g. after picking a rhythm). */
export function home(): void {
  const n = nav.get().length - 1;
  if (n > 0) history.go(-n);
}

if (typeof window !== 'undefined') {
  history.replaceState({ depth: 1 }, '');
  window.addEventListener('popstate', (e) => {
    const depth = (e.state as { depth?: number } | null)?.depth ?? 1;
    nav.set((st) => st.slice(0, Math.max(1, depth)));
  });
}
