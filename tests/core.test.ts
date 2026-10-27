import { describe, expect, it } from 'vitest';
import { TapTempo, rateFor, tempoRange } from '../src/audio/tempo';
import { DEFAULT_METRO, USULS, defaultMarks, groupingOptions, meterForRhythm, planBar, sanitizeMetro, withUsul } from '../src/audio/usuls';
import { decodeListLink, encodeListLink, fromFile, moveItem, sanitizeLists, toFile, type Playlist } from '../src/data/playlists';
import { fold, sanitizeCatalog, searchRhythms } from '../src/data/rhythms';

describe('tempo', () => {
  it('limits the rate to 0.5–2', () => {
    expect(rateFor(100, 300)).toBe(2);
    expect(rateFor(100, 20)).toBe(0.5);
    expect(rateFor(88, 99)).toBeCloseTo(1.125);
    expect(tempoRange(88)).toEqual([44, 176]);
  });

  it('tap tempo averages the intervals and resets after a pause', () => {
    const t = new TapTempo();
    expect(t.tap(0)).toBeUndefined();
    expect(t.tap(500)).toBe(120);
    expect(t.tap(1000)).toBe(120);
    expect(t.tap(5000)).toBeUndefined();
    expect(t.tap(5600)).toBe(100);
  });
});

describe('usuls', () => {
  it('every usul pattern and grouping fits its meter', () => {
    for (const u of USULS) {
      expect(u.pattern.length, u.id).toBe(u.beats);
      expect(u.grouping.reduce((a, b) => a + b, 0), u.id).toBe(u.beats);
      expect(u.pattern[0], u.id).toBe('D');
    }
  });

  it('aksak accents fall on the group starts', () => {
    expect(defaultMarks(9, [2, 2, 2, 3])).toEqual(['accent', 'normal', 'accent', 'normal', 'accent', 'normal', 'accent', 'normal', 'normal']);
    expect(groupingOptions(7)).toContainEqual([3, 2, 2]);
  });

  it('plans strokes for an usul and clicks with subdivisions otherwise', () => {
    const s = withUsul(DEFAULT_METRO, USULS.find((u) => u.id === 'aksak')!);
    const plan = planBar(s);
    expect(plan.filter((e) => e.stroke).map((e) => e.stroke).join('')).toBe('DTDTK');
    const clicks = planBar({ ...DEFAULT_METRO, subdivision: 2 });
    expect(clicks.map((e) => e.at)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]);
    expect(clicks[0].level).toBe('bar');
  });

  it('takes the meter from the rhythm and sanitizes stored settings', () => {
    const s = meterForRhythm(DEFAULT_METRO, '9/8');
    expect([s.beats, s.unit]).toEqual([9, 8]);
    expect(s.grouping).toEqual([2, 2, 2, 3]);
    expect(s.factor).toBe(2);
    expect(meterForRhythm(DEFAULT_METRO, '2/4').factor).toBe(1);
    const bad = sanitizeMetro({ beats: 99, unit: 3, marks: 'x', bpm: 'a', usulId: 'aksak' });
    expect(bad.beats).toBe(16);
    expect(bad.unit).toBe(4);
    expect(bad.usulId).toBe('');
    expect(bad.marks).toHaveLength(16);
  });
});

describe('playlists', () => {
  const list: Playlist = {
    id: 'a',
    name: 'Türküler',
    entries: [
      { id: '1', song: 'Uzun ince bir yoldayım', rhythmId: 'slow-turku-ritim-tempo-105', bpm: 96 },
      { id: '2', song: 'Çanakkale', rhythmId: '2-4-ankara-ritim-1-tempo-90' },
    ],
  };

  it('round-trips through a share link and a file', () => {
    const back = decodeListLink(encodeListLink(list))!;
    expect(back.name).toBe('Türküler');
    expect(back.entries.map((e) => [e.song, e.rhythmId, e.bpm])).toEqual([
      ['Uzun ince bir yoldayım', 'slow-turku-ritim-tempo-105', 96],
      ['Çanakkale', '2-4-ankara-ritim-1-tempo-90', undefined],
    ]);
    const f = fromFile(JSON.parse(JSON.stringify(toFile(list))))!;
    expect(f.entries).toHaveLength(2);
    expect(fromFile({ type: 'other' })).toBeUndefined();
    expect(decodeListLink('%%%')).toBeUndefined();
  });

  it('drops invalid stored data and makes entry ids unique', () => {
    const out = sanitizeLists([{ name: '' }, 'x', { name: 'A', entries: [{ id: 'z', song: 'S', rhythmId: 'r' }, { id: 'z', song: 'T', rhythmId: 'r', bpm: 9999 }, { song: '' }] }]);
    expect(out).toHaveLength(1);
    expect(out[0].entries).toHaveLength(2);
    expect(new Set(out[0].entries.map((e) => e.id)).size).toBe(2);
    expect(out[0].entries[1].bpm).toBeUndefined();
  });

  it('moves items', () => {
    expect(moveItem([1, 2, 3], 0, 2)).toEqual([2, 3, 1]);
    expect(moveItem([1, 2, 3], 0, 5)).toEqual([1, 2, 3]);
  });
});

describe('catalog', () => {
  it('folds Turkish letters for search', () => {
    expect(fold('Kaşıklı ÇİFTETELLİ')).toBe('kasikli ciftetelli');
    const { rhythms } = sanitizeCatalog({
      categories: [{ id: 'halay', label: 'Halay' }],
      rhythms: [
        { id: 'a', title: 'Kaşıklı oyun havası', category: '2-4', meter: '2/4', bpm: 100, file: 'a.mp3' },
        { id: 'b', title: 'Halay', category: 'halay', bpm: 95, file: 'b.mp3' },
        { id: 3, title: 'bad' },
      ],
    });
    expect(rhythms).toHaveLength(2);
    expect(searchRhythms(rhythms, 'kasikli').map((r) => r.id)).toEqual(['a']);
    expect(searchRhythms(rhythms, '', 'halay').map((r) => r.id)).toEqual(['b']);
  });
});
