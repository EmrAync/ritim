// "Telefona kur": a banner on the main screen and a step-by-step guide.
// Android Chrome/Edge install with one tap (the browser's own prompt);
// iPhone needs Paylaş → Ana Ekrana Ekle, shown with pictures; in-app
// browsers (WhatsApp, Instagram…) are sent to Chrome / Safari first.

import { useState, type ReactNode } from 'react';
import { createStore, readLocal, useStore, writeLocal } from '../lib/store';
import { chromeIntent, installRoute, type InstallRoute } from '../lib/platform';
import { Sheet, toast } from './common';
import { Icon } from './icons';

interface InstallPrompt {
  prompt(): Promise<void>;
  userChoice?: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export const installPrompt = createStore<InstallPrompt | undefined>(undefined);
const installed = createStore(false);
export const guideOpen = createStore(false);

const DISMISS_KEY = 'ritim.install.later';
const LATER_DAYS = 7;

const isStandalone = (): boolean =>
  typeof window !== 'undefined' &&
  (window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true);

export const currentRoute = (): InstallRoute =>
  installed.get()
    ? 'installed'
    : installRoute(navigator.userAgent, isStandalone(), navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPrompt.set(e as unknown as InstallPrompt);
  });
  window.addEventListener('appinstalled', () => {
    installed.set(true);
    installPrompt.set(undefined);
    guideOpen.set(false);
    toast('Uygulama kuruldu. Ana ekrandaki “Ritim” simgesinden açabilirsiniz.');
  });
}

/** One tap where the browser allows it, otherwise the picture guide. */
export async function startInstall(): Promise<void> {
  const p = installPrompt.get();
  if (!p) {
    guideOpen.set(true);
    return;
  }
  try {
    await p.prompt();
    const choice = await p.userChoice;
    if (choice?.outcome === 'accepted') installPrompt.set(undefined);
  } catch {
    guideOpen.set(true);
  }
}

/** iOS share icon (square with an arrow up), as in Safari. */
const ShareIcon = () => (
  <svg className="inline-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Paylaş">
    <path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" />
  </svg>
);
const AddIcon = () => (
  <svg className="inline-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-label="Ekle">
    <rect x="4" y="4" width="16" height="16" rx="4" />
    <path d="M12 8v8M8 12h8" />
  </svg>
);
const Dots = () => <b className="inline-key">⋮</b>;
const Lines = () => <b className="inline-key">≡</b>;

function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol className="install-steps">
      {items.map((it, i) => (
        <li key={i}>
          <span className="step-num">{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Guide({ route }: { route: InstallRoute }) {
  const prompt = useStore(installPrompt);
  switch (route) {
    case 'ios-safari':
      return (
        <>
          <Steps
            items={[
              <>
                Ekranın altındaki <b>Paylaş</b> düğmesine dokunun <ShareIcon /> <small>(iPad’de sağ üstte)</small>
              </>,
              <>
                Açılan listede aşağı kaydırıp <b>Ana Ekrana Ekle</b>’yi seçin <AddIcon />
              </>,
              <>
                Sağ üstte <b>Ekle</b>’ye dokunun.
              </>,
            ]}
          />
          <div className="install-arrow" aria-hidden="true">
            ↓ Paylaş düğmesi aşağıda ↓
          </div>
        </>
      );
    case 'ios-other':
      return (
        <Steps
          items={[
            <>
              Adres çubuğundaki <b>Paylaş</b> düğmesine dokunun <ShareIcon /> <small>(Chrome’da sağ üstte)</small>
            </>,
            <>
              <b>Ana Ekrana Ekle</b>’yi seçin <AddIcon />
            </>,
            <>
              <b>Ekle</b>’ye dokunun. Olmazsa linki <b>Safari</b>’de açıp orada ekleyin.
            </>,
          ]}
        />
      );
    case 'ios-inapp':
      return (
        <Steps
          items={[
            <>
              Bu sayfa bir uygulamanın içinde açıldı; buradan kurulamaz. Sağ üstteki <b>•••</b> düğmesine dokunun.
            </>,
            <>
              <b>Safari’de aç</b>’ı seçin.
            </>,
            <>
              Safari’de <b>Paylaş</b> <ShareIcon /> → <b>Ana Ekrana Ekle</b>.
            </>,
          ]}
        />
      );
    case 'samsung':
      return (
        <Steps
          items={[
            <>
              Sağ alttaki menü düğmesine <Lines /> dokunun.
            </>,
            <>
              <b>Sayfayı ekle</b> (ya da <b>+ Ekle</b>) → <b>Ana ekran</b>’ı seçin.
            </>,
            <>
              <b>Ekle</b>’ye dokunun. Simge ana ekranınıza gelir.
            </>,
          ]}
        />
      );
    case 'android-inapp':
      return (
        <>
          <p>Bu sayfa bir uygulamanın (WhatsApp, Instagram…) içinde açıldı; buradan kurulamaz. Önce Chrome’da açın:</p>
          <a className="primary-btn" href={chromeIntent(location.href)}>
            Chrome’da aç
          </a>
          <p className="hint">Açılmazsa sağ üstteki <Dots /> → “Tarayıcıda aç” / “Chrome’da aç”.</p>
        </>
      );
    case 'android':
      return prompt ? (
        <p>Aşağıdaki düğmeye basın, çıkan pencerede “Yükle”ye dokunun.</p>
      ) : (
        <Steps
          items={[
            <>
              Sağ üstteki <Dots /> menüye dokunun.
            </>,
            <>
              <b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>’yi seçin.
            </>,
            <>
              <b>Yükle</b>’ye dokunun.
            </>,
          ]}
        />
      );
    case 'desktop':
      return prompt ? (
        <p>Aşağıdaki düğmeye basın; bilgisayarınıza program olarak kurulur.</p>
      ) : (
        <p>
          Chrome veya Edge’de adres çubuğunun sağındaki <b>kur</b> simgesine (⊕ / ekran ve ok) tıklayın. Telefonda açmak için bu sayfanın linkini telefonunuza gönderin.
        </p>
      );
    case 'installed':
      return <p>Uygulama zaten kurulu; ana ekrandaki “Ritim” simgesinden açabilirsiniz.</p>;
  }
}

export function InstallSheet() {
  const open = useStore(guideOpen);
  const prompt = useStore(installPrompt);
  if (!open) return null;
  const route = currentRoute();
  const close = () => guideOpen.set(false);
  return (
    <Sheet title="Telefona kur" onClose={close}>
      <p className="hint">Kurulunca ana ekranda “Ritim” simgesi olur; normal bir uygulama gibi tam ekran açılır ve internetsiz de çalışır.</p>
      <Guide route={route} />
      {prompt && (
        <button
          className="primary-btn"
          onClick={() => {
            close();
            void startInstall();
          }}
        >
          <Icon name="download" /> Şimdi kur
        </button>
      )}
    </Sheet>
  );
}

/** Banner on the main screen until installed (or hidden for a week). */
export function InstallBanner() {
  useStore(installed);
  const prompt = useStore(installPrompt);
  const [later, setLater] = useState(() => {
    const t = readLocal(DISMISS_KEY);
    return typeof t === 'number' && Date.now() - t < LATER_DAYS * 86400000;
  });
  const route = currentRoute();
  if (route === 'installed' || later) return null;
  const oneTap = !!prompt;
  return (
    <div className="install-banner">
      <Icon name="phone" size={22} />
      <button className="install-text" onClick={() => void startInstall()}>
        <b>Telefona uygulama olarak kur</b>
        <small>{oneTap ? 'Tek dokunuşla' : 'Nasıl yapılacağını göstereyim'}</small>
      </button>
      <button className="install-go" onClick={() => void startInstall()}>
        Kur
      </button>
      <button
        className="icon-btn small"
        aria-label="Daha sonra"
        onClick={() => {
          writeLocal(DISMISS_KEY, Date.now());
          setLater(true);
        }}
      >
        <Icon name="close" size={18} />
      </button>
    </div>
  );
}
