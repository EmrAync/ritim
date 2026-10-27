// Shared layout pieces: screen header, bottom sheet, toast.

import { useEffect, type ReactNode } from 'react';
import { createStore, useStore } from '../lib/store';
import { Icon } from './icons';
import { back } from './nav';

export function Header({ title, right, onBack = back }: { title: ReactNode; right?: ReactNode; onBack?: () => void }) {
  return (
    <header className="bar">
      <button className="icon-btn" onClick={onBack} aria-label="Geri">
        <Icon name="back" />
      </button>
      <h1 className="bar-title">{title}</h1>
      <div className="bar-right">{right}</div>
    </header>
  );
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose(): void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

const toastStore = createStore<string | undefined>(undefined);
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string): void {
  toastStore.set(msg);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastStore.set(undefined), 2600);
}

export function Toast() {
  const msg = useStore(toastStore);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}
