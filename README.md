# Ritim

Telefonda kayıtlı ritimleri tempo ayarıyla çalan basit uygulama. Kurulum gerekmez: linki açmak yeterli.

**Link:** https://emraync.github.io/ritim/

## Ne yapar?

- **Ritim çalar:** 87 ritim (2/4, 3/4, 4/4, 5/8, 6/8, 7/8, 9/8, 10/8, halay, slow türkü, çiftetelli, dem). Ritim kesintisiz döner.
- **Tempo:** Büyük döner düğme, − / + tuşları ve **TAP** (istenen hızda 3–4 kez dokunun). Tempo değişince ses tonu değişmez.
- **Zamanlayıcı:** Ritim seçilen dakika sonunda yavaşça kısılıp durur, ya da sınırsız çalar.
- **Listelerim:** Şarkı adlarınızı hangi ritim ve tempoyla çalınacaklarıyla birlikte kaydedin. Listeyi link ya da dosya ile paylaşın.
- **Metronom:** Türk usulleri (aksaklar dahil), vurgu ayarı, tahta tık / darbuka / davul / def / bateri sesleri; ritimle aynı tempoda ve birlikte çalabilir.
- **İnternetsiz:** Çalınan ritimler telefona kaydedilir; ⋮ → “İnternetsiz kullanım” ile hepsi indirilebilir.

## Telefona kurma

- **Android (Chrome):** ⋮ menü → “Ana ekrana ekle”.
- **iPhone (Safari):** Paylaş ⬆ → “Ana Ekrana Ekle”.

## Geliştirme

```bash
npm install
npm run dev        # yerel deneme
npm test           # testler
npm run build      # dist/ klasörüne derleme
```

Ritim dosyaları `scripts/build-rhythms.mjs` ile orijinal kayıtlardan üretilir (yaklaşık 3 dakikalık, ek yeri duyulmayan döngüler, 128 kbps MP3) ve `public/rhythms.json` listesi yazılır:

```bash
node scripts/build-rhythms.mjs <kayıt-klasörü> <ffmpeg.exe>
```

`main` dalına her gönderimde GitHub Actions uygulamayı derleyip GitHub Pages’e yayınlar.

Kişisel, ticari olmayan kullanım içindir.
