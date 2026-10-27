// Rhythm library: category chips, search, list. Used as a screen (pick →
// play) and as a picker for playlist entries.

import { useMemo, useState } from 'react';
import { player, selectRhythm } from '../audio/player';
import { offline } from '../data/offline';
import { catalog, formatTime, searchRhythms, type Rhythm } from '../data/rhythms';
import { useStore } from '../lib/store';
import { Header } from './common';
import { Icon } from './icons';
import { home } from './nav';
import { AddToListSheet } from './Lists';

function RhythmList({ onPick, onAdd, selected }: { onPick(r: Rhythm): void; onAdd?: (r: Rhythm) => void; selected?: string }) {
  const cat = useStore(catalog);
  const off = useStore(offline);
  const [q, setQ] = useState('');
  const [category, setCategory] = useState<string | undefined>(undefined);
  const found = useMemo(() => searchRhythms(cat.rhythms, q, category), [cat.rhythms, q, category]);
  const groups = cat.categories.filter((c) => found.some((r) => r.category === c.id));

  return (
    <>
      <div className="search">
        <Icon name="search" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ritim ara (ör. halay, 9/8, ankara)" enterKeyHint="search" />
        {q && (
          <button className="icon-btn small" onClick={() => setQ('')} aria-label="Temizle">
            <Icon name="close" size={18} />
          </button>
        )}
      </div>
      <div className="chips-scroll">
        <button className={!category ? 'chip on' : 'chip'} onClick={() => setCategory(undefined)}>
          Tümü
        </button>
        {cat.categories.map((c) => (
          <button key={c.id} className={category === c.id ? 'chip on' : 'chip'} onClick={() => setCategory(category === c.id ? undefined : c.id)}>
            {c.label}
          </button>
        ))}
      </div>
      <div className="scroll">
        {!cat.loaded && <p className="hint pad">Yükleniyor…</p>}
        {cat.error && <p className="error pad">{cat.error}</p>}
        {cat.loaded && !found.length && <p className="hint pad">Sonuç yok.</p>}
        {groups.map((g) => (
          <section key={g.id}>
            <h3 className="group-title">{g.label}</h3>
            {found
              .filter((r) => r.category === g.id)
              .map((r) => (
                <div key={r.id} className={r.id === selected ? 'row on' : 'row'}>
                  <button className="row-main" onClick={() => onPick(r)}>
                    <span className="row-title">{r.title}</span>
                    <span className="row-sub">
                      {[r.meter, r.bpm ? `${r.bpmEstimated ? '≈' : ''}${r.bpm}${r.bpmTo ? `→${r.bpmTo}` : ''} BPM` : undefined, formatTime(r.duration)]
                        .filter(Boolean)
                        .join(' · ')}
                      {off.has(r.id) && <Icon name="check" size={14} className="saved" />}
                    </span>
                  </button>
                  {onAdd && (
                    <button className="icon-btn" onClick={() => onAdd(r)} aria-label="Listeye ekle">
                      <Icon name="plus" />
                    </button>
                  )}
                </div>
              ))}
          </section>
        ))}
      </div>
    </>
  );
}

export function LibraryScreen() {
  const { rhythmId } = useStore(player);
  const [adding, setAdding] = useState<Rhythm | undefined>(undefined);
  return (
    <div className="screen">
      <Header title="Ritimler" />
      <RhythmList
        selected={rhythmId}
        onPick={(r) => {
          selectRhythm(r.id);
          home();
        }}
        onAdd={setAdding}
      />
      {adding && <AddToListSheet rhythm={adding} onClose={() => setAdding(undefined)} />}
    </div>
  );
}

/** Full-screen rhythm picker over another screen. */
export function RhythmPicker({ selected, onPick, onClose }: { selected?: string; onPick(r: Rhythm): void; onClose(): void }) {
  return (
    <div className="screen overlay">
      <Header title="Ritim seçin" onBack={onClose} />
      <RhythmList selected={selected} onPick={onPick} />
    </div>
  );
}
