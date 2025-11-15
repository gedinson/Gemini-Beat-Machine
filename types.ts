export type Instrument = 'Kick' | 'Snare' | 'Hi-hat (Closed)' | 'Hi-hat (Open)' | 'Clap' | 'Tom' | 'Rimshot' | 'Cowbell' | 'Cymbal' | 'Shaker';

export type GridState = boolean[][];

export type View = 'sequencer' | 'veo' | 'imageEditor' | 'search' | 'live' | 'tts' | 'fx' | 'piano';

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