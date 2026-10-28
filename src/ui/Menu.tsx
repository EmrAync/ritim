// ⋮ menu: every screen besides the main one, plus app install.

import { engineMode, setEngineMode } from '../audio/player';
import { createStore, useStore } from '../lib/store';
import { Sheet } from './common';
import { Icon, type IconName } from './icons';
import { go, type Screen } from './nav';

interface InstallPrompt {
  prompt(): Promise<void>;
}

export const installPrompt = createStore<InstallPrompt | undefined>(undefined);

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.set(e as unknown as InstallPrompt);
  });
}

const isStandalone = (): boolean =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const ITEMS: { icon: IconName; label: string; sub: string; to: Screen }[] = [
  { icon: 'music', label: 'Ritimler', sub: 'Klasöre göre gözat, ara', to: { name: 'library' } },
  { icon: 'list', label: 'Listelerim', sub: 'Şarkı listeleri, paylaşım', to: { name: 'lists' } },
  { icon: 'metronome', label: 'Metronom', sub: 'Usuller, aksak ölçüler', to: { name: 'metronome' } },
  { icon: 'offline', label: 'İnternetsiz kullanım', sub: 'Ritimleri telefona indir', to: { name: 'offline' } },
  { icon: 'info', label: 'Nasıl kullanılır?', sub: 'Kısa yardım', to: { name: 'help' } },
];

export function Menu({ onClose }: { onClose(): void }) {
  const prompt = useStore(installPrompt);
  const mode = useStore(engineMode);
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return (
    <Sheet title="Menü" onClose={onClose}>
      <nav className="menu">
        {ITEMS.map((it) => (
          <button
            key={it.label}
            className="menu-item"
            onClick={() => {
              onClose();
              go(it.to);
            }}
          >
            <Icon name={it.icon} />
            <span>
              <b>{it.label}</b>
              <small>{it.sub}</small>
            </span>
          </button>
        ))}
        <button className="menu-item" onClick={() => setEngineMode(mode === 'hafif' ? 'kaliteli' : 'hafif')}>
          <span className={mode === 'hafif' ? 'toggle on' : 'toggle'}>
            <span className="toggle-knob" />
          </span>
          <span>
            <b>Hafif ses motoru</b>
            <small>
              {mode === 'hafif' ? 'Açık. ' : 'Ses takılırsa açın (eski / yavaş telefonlar). '}
              Bu modda tempoyu müzik çalarken değiştirmeyin: önce STOP, sonra tempoyu ayarlayın, sonra START.
            </small>
          </span>
        </button>
        {!isStandalone() && (prompt || ios) && (
          <button
            className="menu-item"
            onClick={() => {
              if (prompt) {
                void prompt.prompt();
                installPrompt.set(undefined);
                onClose();
              }
            }}
          >
            <Icon name="phone" />
            <span>
              <b>Ana ekrana ekle</b>
              <small>{prompt ? 'Uygulama gibi açılsın' : 'Safari’de Paylaş ⬆ → “Ana Ekrana Ekle”'}</small>
            </span>
          </button>
        )}
      </nav>
    </Sheet>
  );
}
