// Which install route a browser offers, from its user agent (pure, testable).

export type InstallRoute =
  /** Already opened as the installed app. */
  | 'installed'
  /** iPhone/iPad Safari: Paylaş → Ana Ekrana Ekle. */
  | 'ios-safari'
  /** Chrome / Firefox / Edge on iPhone: share button in the address bar. */
  | 'ios-other'
  /** Inside WhatsApp, Instagram, Facebook… on iPhone: open in Safari first. */
  | 'ios-inapp'
  /** Samsung Internet: menu → Sayfayı ekle → Ana ekran. */
  | 'samsung'
  /** Inside an app's own browser on Android: open in Chrome first. */
  | 'android-inapp'
  /** Chrome (or similar) on Android without the one-tap prompt: ⋮ → Uygulamayı yükle. */
  | 'android'
  /** Computer browsers. */
  | 'desktop';

const INAPP = /FBAN|FBAV|FB_IAB|Instagram|Line\/|Twitter|Snapchat|TikTok|musical_ly|WhatsApp|; wv\)|GSA\//i;

export function installRoute(ua: string, standalone: boolean, touchMac = false): InstallRoute {
  if (standalone) return 'installed';
  const ios = /iPhone|iPad|iPod/i.test(ua) || touchMac;
  if (ios) {
    if (INAPP.test(ua)) return 'ios-inapp';
    if (/CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua)) return 'ios-other';
    return 'ios-safari';
  }
  if (/Android/i.test(ua)) {
    if (/SamsungBrowser/i.test(ua)) return 'samsung';
    if (INAPP.test(ua)) return 'android-inapp';
    return 'android';
  }
  return 'desktop';
}

/** Android intent that opens the page in Chrome (from an app's in-app browser). */
export function chromeIntent(href: string): string {
  const u = new URL(href);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.replace(':', '')};package=com.android.chrome;end`;
}
