// Meters a folk song can be in, as groups of eighth notes per beat:
// a short beat is 2 eighths, a long ("topal") beat is 3. Even meters have
// equal beats. Names are the usual Turkish usul / dance names.

export interface UsulDef {
  /** Eighths per beat, in the order heard from the cycle start (strong beat). */
  groups: number[];
  /** "9/8" */
  meter: string;
  name: string;
  /** Where it is typical, for the result text. */
  examples: string;
}

export const AKSAK_USULS: UsulDef[] = [
  { groups: [2, 3], meter: '5/8', name: 'Türk aksağı (2+3)', examples: 'Bazı Rumeli ve Ege türküleri' },
  { groups: [3, 2], meter: '5/8', name: 'Türk aksağı (3+2)', examples: 'Bazı Doğu ve Karadeniz türküleri' },
  { groups: [2, 2, 3], meter: '7/8', name: 'Aksak (2+2+3)', examples: 'Rumeli, Balkan havaları' },
  { groups: [3, 2, 2], meter: '7/8', name: 'Devr-i hindî (3+2+2)', examples: 'Çok sayıda türkü ve şarkı' },
  { groups: [2, 3, 2], meter: '7/8', name: 'Aksak (2+3+2)', examples: 'Daha seyrek' },
  { groups: [2, 2, 2, 3], meter: '9/8', name: 'Karşılama / Aksak (2+2+2+3)', examples: 'Karşılama, roman havası, Kırşehir, Ankara oyun havaları' },
  { groups: [3, 2, 2, 2], meter: '9/8', name: 'Aksak (3+2+2+2)', examples: 'Bazı zeybekler ve oyun havaları' },
  { groups: [2, 3, 2, 2], meter: '9/8', name: 'Aksak (2+3+2+2)', examples: 'Daha seyrek' },
  { groups: [2, 2, 3, 2], meter: '9/8', name: 'Aksak (2+2+3+2)', examples: 'Daha seyrek' },
  { groups: [3, 2, 2, 3], meter: '10/8', name: 'Aksak semai / Curcuna (3+2+2+3)', examples: 'Semailer, bazı türküler' },
  { groups: [2, 3, 2, 3], meter: '10/8', name: 'Aksak (2+3+2+3)', examples: 'Daha seyrek' },
];

export interface EvenDef {
  beats: number;
  meter: string;
  name: string;
}

export const EVEN_METERS: EvenDef[] = [
  { beats: 2, meter: '2/4', name: 'Düz 2/4 (Nim sofyan, halay, oyun havası)' },
  { beats: 3, meter: '3/4', name: 'Düz 3/4' },
  { beats: 4, meter: '4/4', name: 'Düz 4/4 (Sofyan)' },
];

/** Same cycle read from another beat (a rotation), e.g. [2,2,3] → [2,3,2]. */
export function rotate(g: number[], k: number): number[] {
  return g.map((_, i) => g[(i + k) % g.length]);
}
