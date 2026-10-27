import { useEffect } from 'react';
import { player } from './audio/player';
import { catalog, loadCatalog, rhythmById } from './data/rhythms';
import { refreshOffline } from './data/offline';
import { useStore } from './lib/store';
import { Toast } from './ui/common';
import { HelpScreen, OfflineScreen } from './ui/InfoScreens';
import { LibraryScreen } from './ui/Library';
import { checkLinkImport } from './ui/listShare';
import { ImportPrompt, ListScreen, ListsScreen } from './ui/Lists';
import { MainScreen } from './ui/MainScreen';
import { MetronomeScreen } from './ui/MetronomeScreen';
import { nav } from './ui/nav';

export function App() {
  const stack = useStore(nav);
  const s = stack[stack.length - 1];

  useEffect(() => {
    void loadCatalog().then(() => {
      const all = catalog.get().rhythms;
      // First visit (or the saved rhythm was removed): start on the first rhythm.
      if (all.length && !rhythmById(player.get().rhythmId)) player.set((s) => ({ ...s, rhythmId: all[0].id, bpm: all[0].bpm ?? 100, queue: undefined }));
      return refreshOffline(all);
    });
    checkLinkImport();
    window.addEventListener('hashchange', checkLinkImport);
    return () => window.removeEventListener('hashchange', checkLinkImport);
  }, []);

  return (
    <div className="app">
      {/* The main screen stays mounted so going back is instant. */}
      <div hidden={s.name !== 'main'} className="layer">
        <MainScreen />
      </div>
      {s.name === 'library' && <LibraryScreen />}
      {s.name === 'lists' && <ListsScreen />}
      {s.name === 'list' && <ListScreen id={s.id} />}
      {s.name === 'metronome' && <MetronomeScreen />}
      {s.name === 'offline' && <OfflineScreen />}
      {s.name === 'help' && <HelpScreen />}
      <ImportPrompt />
      <Toast />
    </div>
  );
}
