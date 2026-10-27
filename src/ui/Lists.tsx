// Playlists: overview, one list with its songs, entry editor, "add to list".

import { useRef, useState } from 'react';
import { player, selectEntry, setOrder } from '../audio/player';
import { downloadAll, formatMB, offline } from '../data/offline';
import {
  addEntry, createList, deleteEntry, deleteList, importList, moveEntry, moveList, playlists, renameList, updateEntry,
  type ListEntry, type Playlist,
} from '../data/playlists';
import { catalog, rhythmById, rhythmSubtitle, type Rhythm } from '../data/rhythms';
import { useStore } from '../lib/store';
import { Header, Sheet, toast } from './common';
import { Icon } from './icons';
import { RhythmPicker } from './Library';
import { pendingImport, readListFile, shareFile, shareLink } from './listShare';
import { back, go, home } from './nav';

function NameSheet({ title, initial = '', onSave, onClose }: { title: string; initial?: string; onSave(name: string): void; onClose(): void }) {
  const [name, setName] = useState(initial);
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) {
            onSave(name);
            onClose();
          }
        }}
      >
        <input className="field" autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="ör. Türküler, Oyun havaları" />
        <button className="primary-btn" type="submit" disabled={!name.trim()}>
          Kaydet
        </button>
      </form>
    </Sheet>
  );
}

function ListActions({ list, index, onClose, onRename, onDeleted }: { list: Playlist; index: number; onClose(): void; onRename(): void; onDeleted?: () => void }) {
  const count = playlists.get().length;
  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };
  return (
    <Sheet title={list.name} onClose={onClose}>
      <nav className="menu">
        <button className="menu-item" onClick={act(() => void shareLink(list))}>
          <Icon name="link" />
          <span><b>Link ile paylaş</b><small>WhatsApp vb. ile gönder; açan kişi listeyi ekler</small></span>
        </button>
        <button className="menu-item" onClick={act(() => void shareFile(list))}>
          <Icon name="share" />
          <span><b>Dosya olarak kaydet / gönder</b><small>.ritim.json dosyası</small></span>
        </button>
        <button className="menu-item" onClick={() => { onClose(); onRename(); }}>
          <Icon name="edit" />
          <span><b>Adını değiştir</b></span>
        </button>
        {index > 0 && (
          <button className="menu-item" onClick={act(() => moveList(index, index - 1))}>
            <Icon name="up" />
            <span><b>Yukarı taşı</b></span>
          </button>
        )}
        {index < count - 1 && (
          <button className="menu-item" onClick={act(() => moveList(index, index + 1))}>
            <Icon name="down" />
            <span><b>Aşağı taşı</b></span>
          </button>
        )}
        <button
          className="menu-item danger"
          onClick={act(() => {
            if (confirm(`“${list.name}” silinsin mi?`)) {
              deleteList(list.id);
              onDeleted?.();
            }
          })}
        >
          <Icon name="trash" />
          <span><b>Listeyi sil</b></span>
        </button>
      </nav>
    </Sheet>
  );
}

export function ListsScreen() {
  const lists = useStore(playlists);
  const [creating, setCreating] = useState(false);
  const [actions, setActions] = useState<string | undefined>(undefined);
  const [renaming, setRenaming] = useState<Playlist | undefined>(undefined);
  const file = useRef<HTMLInputElement>(null);
  const actList = lists.find((l) => l.id === actions);
  return (
    <div className="screen">
      <Header
        title="Listelerim"
        right={
          <button className="icon-btn" onClick={() => file.current?.click()} aria-label="Dosyadan liste al">
            <Icon name="upload" />
          </button>
        }
      />
      <input
        ref={file}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void readListFile(f);
          e.target.value = '';
        }}
      />
      <div className="scroll">
        <button className="add-btn" onClick={() => setCreating(true)}>
          <Icon name="plus" /> Yeni liste
        </button>
        {!lists.length && (
          <p className="hint pad">
            Liste oluşturup şarkı adlarınızı ve hangi ritimle çalınacaklarını ekleyin. Bir ritim birden çok şarkıda kullanılabilir. Listeyi link ile arkadaşlarınıza gönderebilirsiniz.
          </p>
        )}
        {lists.map((l) => (
          <div key={l.id} className="row">
            <button className="row-main" onClick={() => go({ name: 'list', id: l.id })}>
              <span className="row-title">{l.name}</span>
              <span className="row-sub">{l.entries.length} şarkı</span>
            </button>
            <button className="icon-btn" onClick={() => setActions(l.id)} aria-label="Liste seçenekleri">
              <Icon name="more" />
            </button>
          </div>
        ))}
      </div>
      {creating && <NameSheet title="Yeni liste" onSave={(n) => go({ name: 'list', id: createList(n).id })} onClose={() => setCreating(false)} />}
      {actList && <ListActions list={actList} index={lists.indexOf(actList)} onClose={() => setActions(undefined)} onRename={() => setRenaming(actList)} />}
      {renaming && <NameSheet title="Listenin adı" initial={renaming.name} onSave={(n) => renameList(renaming.id, n)} onClose={() => setRenaming(undefined)} />}
    </div>
  );
}

function EntrySheet({ listId, entry, onClose }: { listId: string; entry?: ListEntry; onClose(): void }) {
  const pl = useStore(player);
  const [song, setSong] = useState(entry?.song ?? '');
  const [rhythmId, setRhythmId] = useState(entry?.rhythmId ?? pl.rhythmId ?? '');
  const [bpm, setBpm] = useState(entry?.bpm ? String(entry.bpm) : '');
  const [picking, setPicking] = useState(false);
  const r = rhythmById(rhythmId);
  const n = Number(bpm);
  const bpmVal = bpm && n >= 20 && n <= 400 ? Math.round(n) : undefined;
  const ok = song.trim() && r;
  const save = () => {
    if (!ok) return;
    if (entry) updateEntry(listId, entry.id, { song, rhythmId, bpm: bpmVal });
    else addEntry(listId, { song, rhythmId, bpm: bpmVal });
    onClose();
  };
  if (picking)
    return (
      <RhythmPicker
        selected={rhythmId}
        onPick={(x) => {
          setRhythmId(x.id);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    );
  return (
    <Sheet title={entry ? 'Şarkıyı düzenle' : 'Şarkı ekle'} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <label className="label">Şarkının adı</label>
        <input className="field" autoFocus={!entry} value={song} maxLength={120} onChange={(e) => setSong(e.target.value)} placeholder="ör. Uzun ince bir yoldayım" />
        <label className="label">Ritim</label>
        <button type="button" className="field pick" onClick={() => setPicking(true)}>
          {r ? (
            <span>
              <b>{r.title}</b> <small>{rhythmSubtitle(r)}{r.bpm ? ` · ${r.bpm} BPM` : ''}</small>
            </span>
          ) : (
            <span className="muted">Ritim seçin…</span>
          )}
          <Icon name="next" size={18} />
        </button>
        <label className="label">Tempo (boş bırakılırsa kayıt temposu)</label>
        <div className="inline">
          <input className="field" inputMode="numeric" value={bpm} onChange={(e) => setBpm(e.target.value.replace(/\D/g, '').slice(0, 3))} placeholder={r?.bpm ? String(r.bpm) : 'BPM'} />
          {pl.rhythmId === rhythmId && (
            <button type="button" className="chip" onClick={() => setBpm(String(pl.bpm))}>
              Şu anki: {pl.bpm}
            </button>
          )}
        </div>
        <button className="primary-btn" type="submit" disabled={!ok}>
          Kaydet
        </button>
      </form>
    </Sheet>
  );
}

export function ListScreen({ id }: { id: string }) {
  const lists = useStore(playlists);
  const pl = useStore(player);
  const off = useStore(offline);
  useStore(catalog);
  const list = lists.find((l) => l.id === id);
  const [edit, setEdit] = useState(false);
  const [editing, setEditing] = useState<ListEntry | 'new' | undefined>(undefined);
  const [actions, setActions] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [dl, setDl] = useState<string | undefined>(undefined);
  if (!list) {
    return (
      <div className="screen">
        <Header title="Liste" />
        <p className="hint pad">Bu liste silinmiş.</p>
      </div>
    );
  }
  const rhythms = [...new Set(list.entries.map((e) => e.rhythmId))].map(rhythmById).filter((r): r is Rhythm => !!r);
  const missing = rhythms.filter((r) => !off.has(r.id));
  const missingMB = formatMB(missing.reduce((a, r) => a + r.size, 0));
  const playing = pl.queue?.listId === id ? pl.queue.index : -1;

  return (
    <div className="screen">
      <Header
        title={list.name}
        right={
          <>
            {list.entries.length > 0 && (
              <button className={edit ? 'icon-btn lit' : 'icon-btn'} onClick={() => setEdit(!edit)} aria-label="Sırala / sil">
                <Icon name="edit" />
              </button>
            )}
            <button className="icon-btn" onClick={() => setActions(true)} aria-label="Liste seçenekleri">
              <Icon name="more" />
            </button>
          </>
        }
      />
      <div className="scroll">
        {list.entries.length > 0 && (
          <button
            className="primary-btn"
            onClick={() => {
              setOrder(id);
              home();
            }}
          >
            <Icon name="play" /> Bu listeyi baştan çal
          </button>
        )}
        <button className="add-btn" onClick={() => setEditing('new')}>
          <Icon name="plus" /> Şarkı ekle
        </button>
        {missing.length > 0 && (
          <button
            className="ghost-btn"
            disabled={!!dl}
            onClick={() => {
              setDl('0');
              downloadAll(missing, (d, t) => setDl(`${d}/${t}`))
                .then(() => toast('Listedeki ritimler telefona indirildi'))
                .catch(() => toast('İndirme yarıda kaldı'))
                .finally(() => setDl(undefined));
            }}
          >
            <Icon name="download" size={20} /> {dl ? `İndiriliyor ${dl}` : `İnternetsiz çalmak için indir (${missing.length} ritim, ${missingMB})`}
          </button>
        )}
        {list.entries.map((e, i) => {
          const r = rhythmById(e.rhythmId);
          return (
            <div key={e.id} className={i === playing ? 'row on' : 'row'}>
              <span className="row-num">{i + 1}</span>
              <button
                className="row-main"
                onClick={() => {
                  if (edit) return setEditing(e);
                  selectEntry(id, i);
                  home();
                }}
              >
                <span className="row-title">{e.song}</span>
                <span className="row-sub">
                  {r ? `${r.title} · ${rhythmSubtitle(r)}` : 'Ritim bulunamadı'}
                  {e.bpm ? ` · ${e.bpm} BPM` : ''}
                </span>
              </button>
              {edit ? (
                <span className="row-tools">
                  <button className="icon-btn small" disabled={i === 0} onClick={() => moveEntry(id, i, i - 1)} aria-label="Yukarı">
                    <Icon name="up" size={20} />
                  </button>
                  <button className="icon-btn small" disabled={i === list.entries.length - 1} onClick={() => moveEntry(id, i, i + 1)} aria-label="Aşağı">
                    <Icon name="down" size={20} />
                  </button>
                  <button className="icon-btn small danger" onClick={() => confirm(`“${e.song}” silinsin mi?`) && deleteEntry(id, e.id)} aria-label="Sil">
                    <Icon name="trash" size={20} />
                  </button>
                </span>
              ) : (
                <button className="icon-btn" onClick={() => setEditing(e)} aria-label="Düzenle">
                  <Icon name="edit" size={20} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {editing && <EntrySheet listId={id} entry={editing === 'new' ? undefined : editing} onClose={() => setEditing(undefined)} />}
      {actions && <ListActions list={list} index={lists.indexOf(list)} onClose={() => setActions(false)} onRename={() => setRenaming(true)} onDeleted={back} />}
      {renaming && <NameSheet title="Listenin adı" initial={list.name} onSave={(n) => renameList(id, n)} onClose={() => setRenaming(false)} />}
    </div>
  );
}

/** From the library: add a rhythm to a list under a song name. */
export function AddToListSheet({ rhythm, onClose }: { rhythm: Rhythm; onClose(): void }) {
  const lists = useStore(playlists);
  const pl = useStore(player);
  const [song, setSong] = useState('');
  const [listId, setListId] = useState(lists[0]?.id ?? '');
  const [newName, setNewName] = useState('');
  const useBpm = pl.rhythmId === rhythm.id && pl.bpm !== rhythm.bpm ? pl.bpm : undefined;
  const ok = song.trim() && (listId || newName.trim());
  return (
    <Sheet title="Listeye ekle" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          const id = listId || createList(newName).id;
          addEntry(id, { song, rhythmId: rhythm.id, bpm: useBpm });
          toast(`“${song.trim()}” eklendi`);
          onClose();
        }}
      >
        <p className="hint">
          Ritim: <b>{rhythm.title}</b> · {rhythmSubtitle(rhythm)}
          {useBpm ? ` · ${useBpm} BPM` : ''}
        </p>
        <label className="label">Şarkının adı</label>
        <input className="field" autoFocus value={song} maxLength={120} onChange={(e) => setSong(e.target.value)} placeholder="ör. Çanakkale içinde" />
        <label className="label">Liste</label>
        <div className="chip-grid">
          {lists.map((l) => (
            <button type="button" key={l.id} className={l.id === listId ? 'chip on' : 'chip'} onClick={() => setListId(l.id)}>
              {l.name}
            </button>
          ))}
          <button type="button" className={!listId ? 'chip on' : 'chip'} onClick={() => setListId('')}>
            + Yeni liste
          </button>
        </div>
        {!listId && <input className="field" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} placeholder="Yeni listenin adı" />}
        <button className="primary-btn" type="submit" disabled={!ok}>
          Ekle
        </button>
      </form>
    </Sheet>
  );
}

/** Accept/decline a list received by link or file. */
export function ImportPrompt() {
  const l = useStore(pendingImport);
  useStore(catalog);
  if (!l) return null;
  const close = () => pendingImport.set(undefined);
  const unknown = l.entries.filter((e) => !rhythmById(e.rhythmId)).length;
  return (
    <Sheet title="Paylaşılan liste" onClose={close}>
      <p>
        <b>{l.name}</b> · {l.entries.length} şarkı
      </p>
      <ul className="preview">
        {l.entries.slice(0, 8).map((e) => (
          <li key={e.id}>
            {e.song} <small>{rhythmById(e.rhythmId)?.title ?? '?'}</small>
          </li>
        ))}
        {l.entries.length > 8 && <li className="muted">… {l.entries.length - 8} şarkı daha</li>}
      </ul>
      {unknown > 0 && <p className="hint">{unknown} şarkının ritmi bu uygulamada yok.</p>}
      <button
        className="primary-btn"
        onClick={() => {
          const saved = importList(l);
          close();
          toast(`“${saved.name}” listelerinize eklendi`);
          go({ name: 'list', id: saved.id });
        }}
      >
        Listelerime ekle
      </button>
      <button className="ghost-btn" onClick={close}>
        Vazgeç
      </button>
    </Sheet>
  );
}
