
export type Instrument = 'Kick' | 'Snare' | 'Hi-hat (Closed)' | 'Hi-hat (Open)' | 'Clap' | 'Tom' | 'Rimshot' | 'Cowbell' | 'Cymbal' | 'Shaker' | '808' | 'Congas' | 'Violin' | 'Trumpet' | 'Pianos' | 'High Pitch Piano';

export type GridState = number[][];

export type View = 'sequencer' | 'search' | 'live' | 'fx' | 'piano';

export interface GroundingChunk {
  web?: {
    uri: string;
    title: string;
  };
}

export type BeatPattern = {
  [key in Instrument]?: number[];
};

export type Recording = {
  name: string;
  url: string;
  blob: Blob;
};

export type EQSettings = {
  bass: number; // in dB
  mid: number;
};

export type MixerSettings = {
  volume: number;
  pan: number;
  eq: EQSettings;
  sustain: number;
  reverb: number;
};

export type AllMixerSettings = {
  [key in Instrument]: MixerSettings;
};
