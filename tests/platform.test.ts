import { describe, expect, it } from 'vitest';
import { chromeIntent, installRoute } from '../src/lib/platform';

const UA = {
  iphoneSafari: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  iphoneInstagram: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
  samsung: 'Mozilla/5.0 (Linux; Android 14; SM-S911B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
  androidFacebook: 'Mozilla/5.0 (Linux; Android 14; SM-S911B; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0 Mobile Safari/537.36 [FBAN/EMA;FBLC/tr_TR;FBAV/400.0]',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
};

describe('install route', () => {
  it('picks the right instructions per browser', () => {
    expect(installRoute(UA.iphoneSafari, false)).toBe('ios-safari');
    expect(installRoute(UA.iphoneChrome, false)).toBe('ios-other');
    expect(installRoute(UA.iphoneInstagram, false)).toBe('ios-inapp');
    expect(installRoute(UA.androidChrome, false)).toBe('android');
    expect(installRoute(UA.samsung, false)).toBe('samsung');
    expect(installRoute(UA.androidFacebook, false)).toBe('android-inapp');
    expect(installRoute(UA.windows, false)).toBe('desktop');
    expect(installRoute(UA.androidChrome, true)).toBe('installed');
    // iPad with a desktop user agent (touch Mac).
    expect(installRoute(UA.windows.replace('Windows NT 10.0; Win64; x64', 'Macintosh; Intel Mac OS X 10_15_7'), false, true)).toBe('ios-safari');
  });

  it('builds a Chrome intent link', () => {
    expect(chromeIntent('https://emraync.github.io/ritim/')).toBe('intent://emraync.github.io/ritim/#Intent;scheme=https;package=com.android.chrome;end');
  });
});
