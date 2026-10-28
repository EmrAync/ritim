// ⋮ menu: every screen besides the main one, plus app install.

import { engineMode, setEngineMode } from '../audio/player';
import { useStore } from '../lib/store';
import { Sheet } from './common';
import { Icon, type IconName } from './icons';
import { currentRoute, startInstall } from './Install';
import { go, type Screen } from './nav';

const ITEMS: { icon: IconName; label: string; sub: string; to: Screen }[] = [
  { icon: 'music', label: 'Ritimler', sub: 'Klasöre göre gözat, ara', to: { name: 'library' } },
  { icon: 'list', label: 'Listelerim', sub: 'Şarkı listeleri, paylaşım', to: { name: 'lists' } },
  { icon: 'metronome', label: 'Metronom', sub: 'Usuller, aksak ölçüler, egzersiz', to: { name: 'metronome' } },
  { icon: 'tuner', label: 'Akort (tuner)', sub: 'Bağlama, gitar, kromatik', to: { name: 'tuner' } },
  { icon: 'offline', label: 'İnternetsiz kullanım', sub: 'Ritimleri telefona indir', to: { name: 'offline' } },
  { icon: 'info', label: 'Nasıl kullanılır?', sub: 'Kısa yardım', to: { name: 'help' } },
];

export function Menu({ onClose }: { onClose(): void }) {
  const mode = useStore(engineMode);
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
        {currentRoute() !== 'installed' && (
          <button
            className="menu-item"
            onClick={() => {
              onClose();
              void startInstall();
            }}
          >
            <Icon name="phone" />
            <span>
              <b>Telefona kur</b>
              <small>Ana ekranda uygulama simgesi olsun</small>
            </span>
          </button>
        )}
      </nav>
    </Sheet>
  );
}
