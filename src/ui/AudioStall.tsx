// "Ses durdu" prompt: the phone took the sound away (call, Siri, another app)
// and it did not come back by itself. One tap rebuilds the audio and the
// rhythm continues where it was.

import { player, recoverAudio } from '../audio/player';
import { useStore } from '../lib/store';
import { Icon } from './icons';

export function AudioStall() {
  const { stalled } = useStore(player);
  if (!stalled) return null;
  return (
    <div className="stall" role="alertdialog" aria-live="assertive">
      <button className="stall-btn" onClick={recoverAudio}>
        <Icon name="play" size={34} />
        <b>Ses durdu</b>
        <span>Devam etmek için dokunun</span>
        <small>Telefon sesi başka bir uygulamaya ya da aramaya vermiş olabilir.</small>
      </button>
    </div>
  );
}
