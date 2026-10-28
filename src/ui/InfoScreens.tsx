// Offline storage management and the short help page.

import { useState } from 'react';
import { clearOffline, downloadAll, formatMB, offline, offlineBytes } from '../data/offline';
import { catalog } from '../data/rhythms';
import { useStore } from '../lib/store';
import { Header, toast } from './common';
import { Icon } from './icons';

export function OfflineScreen() {
  const cat = useStore(catalog);
  const off = useStore(offline);
  const [dl, setDl] = useState<string | undefined>(undefined);
  const [abort, setAbort] = useState<AbortController | undefined>(undefined);
  const total = cat.rhythms.reduce((a, r) => a + r.size, 0);
  const have = offlineBytes(cat.rhythms);
  const missing = cat.rhythms.filter((r) => !off.has(r.id));
  return (
    <div className="screen">
      <Header title="İnternetsiz kullanım" />
      <div className="scroll pad">
        <p>
          Çaldığınız her ritim telefona kaydedilir; bir dahaki sefere internet olmadan da çalar. Sahneye ya da çekmeyen bir yere gitmeden önce ritimleri topluca indirebilirsiniz.
        </p>
        <div className="stat">
          <b>{off.size}</b> / {cat.rhythms.length} ritim telefonda · {formatMB(have)}
        </div>
        {missing.length > 0 && (
          <button
            className="primary-btn"
            disabled={!!dl}
            onClick={() => {
              const ac = new AbortController();
              setAbort(ac);
              setDl('0');
              downloadAll(missing, (d, t) => setDl(`${d}/${t}`), ac.signal)
                .then(() => !ac.signal.aborted && toast('Tüm ritimler indirildi'))
                .catch(() => toast('İndirme yarıda kaldı'))
                .finally(() => {
                  setDl(undefined);
                  setAbort(undefined);
                });
            }}
          >
            <Icon name="download" /> {dl ? `İndiriliyor ${dl}` : `Kalan ${missing.length} ritmi indir (${formatMB(total - have)})`}
          </button>
        )}
        {abort && (
          <button className="ghost-btn" onClick={() => abort.abort()}>
            Durdur
          </button>
        )}
        <p className="hint">Liste ekranında yalnızca o listedeki ritimleri de indirebilirsiniz. Wi-Fi’de indirmeniz önerilir.</p>
        {off.size > 0 && (
          <button
            className="ghost-btn danger"
            onClick={() => {
              if (confirm('Telefondaki ritim kayıtları silinsin mi? (Listeleriniz silinmez.)')) void clearOffline().then(() => toast('Silindi'));
            }}
          >
            <Icon name="trash" size={20} /> Telefondaki ritimleri sil
          </button>
        )}
      </div>
    </div>
  );
}

export function HelpScreen() {
  return (
    <div className="screen">
      <Header title="Nasıl kullanılır?" />
      <div className="scroll pad help">
        <h3>Ritim çalma</h3>
        <p>Ortadaki ritim adına dokunup listeden bir ritim seçin, <b>START</b>’a basın. ◀ ▶ ile önceki/sonraki ritme geçersiniz.</p>
        <h3>Tempo</h3>
        <p>
          Büyük düğmeyi parmağınızla çevirin, ya da <b>−</b> / <b>+</b> ile birer birer değiştirin. <b>TAP</b>’e istediğiniz hızda 3–4 kez vurursanız tempo ona ayarlanır. Ses
          tonu değişmez. Düğmedeki küçük çizgi ritmin kaydedildiği tempodur.
        </p>
        <p>
          Menüde “Hafif ses motoru” açıksa (eski telefonlar için) tempoyu müzik çalarken değiştirmeyin: önce <b>STOP</b>, sonra tempoyu ayarlayın, sonra <b>START</b>.
        </p>
        <h3>Zamanlayıcı</h3>
        <p>START’ın altındaki “Süre”ye dokunup ritmin kaç dakika sonra yavaşça kısılıp duracağını seçin.</p>
        <h3>Listelerim</h3>
        <p>
          Şarkılarınızı ve hangi ritimle, hangi tempoda çalınacaklarını listeye ekleyin. Listeden bir şarkıya dokunursanız ritmi ve temposu hazır gelir; ◀ ▶ listede ilerler. ⋮ menüsünden
          listeyi link ile paylaşabilirsiniz.
        </p>
        <h3>Metronom</h3>
        <p>Usul seçin (aksaklar dahil), vuruşlara dokunarak vurguyu değiştirin. “Tempoyu ritme bağla” ile metronom ritimle aynı hızda tıklar.</p>
        <p>
          Üstten <b>Klasik</b> seçilirse tahta, kurmalı metronom görünür; pirinç ağırlığı parmakla aşağı-yukarı kaydırarak tempoyu değiştirebilirsiniz.
        </p>
        <h3>Egzersiz modu</h3>
        <p>
          Metronomda “Egzersiz modu”nu açın: başlangıç ve hedef tempoyu, kaç ölçüde bir ne kadar değişeceğini ve isterseniz toplam süreyi seçin. Hazır programlar (Isınma, Hız
          çalışması, Piramit…) tek dokunuşla ayarlar. “İç tempo çalışması” birkaç ölçü çalıp birkaç ölçü susar; tempoyu içinizden tutmayı çalıştırır.
        </p>
        <h3>Telefona kurma</h3>
        <p>
          Android/Chrome: ⋮ menü → “Ana ekrana ekle”. iPhone/Safari: Paylaş ⬆ → “Ana Ekrana Ekle”. Böylece uygulama gibi açılır; çalınan ritimler internetsiz de çalışır.
        </p>
      </div>
    </div>
  );
}
