import React from 'react';
import { Instrument } from './types';

export const INSTRUMENTS: Instrument[] = ['Kick', 'Snare', 'Hi-hat (Closed)', 'Hi-hat (Open)', 'Clap', 'Tom', 'Rimshot', 'Cowbell', 'Cymbal', 'Shaker'];
export const NUM_STEPS = 32;
export const NUM_TRACKS = INSTRUMENTS.length;

export const IconSpark = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.75.75v3.546l3.246-3.246a.75.75 0 111.06 1.06l-3.246 3.246H18a.75.75 0 010 1.5h-3.69l3.246 3.246a.75.75 0 11-1.06 1.06l-3.246-3.246V18.75a.75.75 0 01-1.5 0v-3.69l-3.246 3.246a.75.75 0 11-1.06-1.06l3.246-3.246H4.5a.75.75 0 010-1.5h3.546L4.796 8.354a.75.75 0 011.06-1.06l3.246 3.246V5.25A.75.75 0 019 4.5z" clipRule="evenodd" />
  </svg>
);

export const IconMovie = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path d="M4.5 4.5a3 3 0 00-3 3v9a3 3 0 003 3h15a3 3 0 003-3v-9a3 3 0 00-3-3h-15z" />
    <path fillRule="evenodd" d="M6.75 7.5a.75.75 0 01.75-.75h9a.75.75 0 01.75.75v9a.75.75 0 01-.75.75h-9a.75.75 0 01-.75-.75v-9zM8.25 9a.75.75 0 00-.75.75v6c0 .414.336.75.75.75h6a.75.75 0 00.75-.75v-6a.75.75 0 00-.75-.75h-6z" clipRule="evenodd" />
  </svg>
);

export const IconImageEdit = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path d="M21.731 2.269a2.625 2.625 0 00-3.712 0l-1.157 1.157 3.712 3.712 1.157-1.157a2.625 2.625 0 000-3.712zM19.513 8.199l-3.712-3.712-12.15 12.15a5.25 5.25 0 00-1.32 2.214l-.8 2.685a.75.75 0 00.933.933l2.685-.8a5.25 5.25 0 002.214-1.32L19.513 8.2z" />
  </svg>
);

export const IconSearch = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path fillRule="evenodd" d="M12.97 4.25a.75.75 0 01.75.75v1.5a.75.75 0 01-1.5 0v-1.5a.75.75 0 01.75-.75zm-1.5 1.5a.75.75 0 00-1.5 0v1.5a.75.75 0 001.5 0v-1.5z" clipRule="evenodd" />
    <path d="M11.91 4.5A.75.75 0 0111.16 6h-1.5a.75.75 0 010-1.5h1.5zM12 4.5h1.5a.75.75 0 010 1.5H12a.75.75 0 010-1.5zM12 4.5a.75.75 0 01.75-.75 3 3 0 013 3A.75.75 0 0115 7.5h-1.5a.75.75 0 010-1.5.75.75 0 00-.75-.75.75.75 0 01-.75-.75zM12 4.5a.75.75 0 00-.75-.75 3 3 0 00-3 3A.75.75 0 009 7.5h1.5a.75.75 0 000-1.5.75.75 0 01.75-.75.75.75 0 00.75-.75z" />
    <path fillRule="evenodd" d="M12.553 14.012a6.75 6.75 0 10-1.106 0 1.501 1.501 0 111.106 0zM17.25 10.5a5.25 5.25 0 11-10.5 0 5.25 5.25 0 0110.5 0z" clipRule="evenodd" />
    <path d="M14.07 14.07a7.5 7.5 0 00-4.14 0L6.93 17.07a.75.75 0 101.06 1.06l3-3a.75.75 0 00-1.06-1.06l-3 3-.001.001a.75.75 0 001.06 1.06l3-3a.75.75 0 00-1.06-1.06l-1.294 1.293a.75.75 0 001.06 1.06L12 16.94l1.293 1.293a.75.75 0 001.06-1.06L13.06 15.88a.75.75 0 00-1.06 1.06l3 3a.75.75 0 001.06-1.06l-3-3a.75.75 0 00-1.06 1.06l3 3a.75.75 0 101.06-1.06l-2.999-2.999z" />
    </svg>
);

export const IconMic = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path d="M8.25 4.5a3.75 3.75 0 117.5 0v8.25a3.75 3.75 0 11-7.5 0V4.5z" />
    <path d="M6 10.5a.75.75 0 01.75.75v1.5a5.25 5.25 0 1010.5 0v-1.5a.75.75 0 011.5 0v1.5a6.75 6.75 0 11-13.5 0v-1.5A.75.75 0 016 10.5z" />
    </svg>
);

export const IconSoundWave = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path fillRule="evenodd" d="M4.125 3C3.504 3 3 3.504 3 4.125v15.75C3 20.496 3.504 21 4.125 21h15.75c.621 0 1.125-.504 1.125-1.125V4.125C21 3.504 20.496 3 19.875 3H4.125zM10.125 8.625a.75.75 0 00-1.5 0v6.75a.75.75 0 001.5 0v-6.75zM12 7.5a.75.75 0 01.75.75v7.5a.75.75 0 01-1.5 0v-7.5A.75.75 0 0112 7.5zM15.375 9.375a.75.75 0 00-1.5 0v5.25a.75.75 0 001.5 0v-5.25z" clipRule="evenodd" />
    </svg>
);

export const IconMusicNote = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path d="M11.25 3v10.5a2.25 2.25 0 102.25 2.25V6.75h3.75V3h-6zM12 15.75a.75.75 0 00-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 00.75-.75v-.008a.75.75 0 00-.75-.75h-.008z" />
    </svg>
);

export const IconRecord = ({ className }: { className?: string }) => (
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
    <path fillRule="evenodd" d="M12 2.25c-5.385 0-9.75 4.365-9.75 9.75s4.365 9.75 9.75 9.75 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25zM12 18a6 6 0 100-12 6 6 0 000 12z" clipRule="evenodd" />
    <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
  </svg>
);

export const IconKeyboard = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={className || 'w-6 h-6'}>
        <path fillRule="evenodd" d="M3.375 3C2.339 3 1.5 3.84 1.5 4.875v14.25C1.5 20.16 2.339 21 3.375 21h17.25c1.036 0 1.875-.84 1.875-1.875V4.875C22.5 3.84 21.661 3 20.625 3H3.375zM9 15.75H7.5v-6h1.5v6zm3 0h-1.5v-6h1.5v6zm3 0h-1.5v-6h1.5v6zm3 0h-1.5v-6h1.5v6zM5.25 15.75H3.75v-6h1.5v6zM15.75 9H15V7.5h.75V9zm-3 0h-.75V7.5H12V9zm-3 0H9V7.5h.75V9zm-3 0H6V7.5h.75V9zm9 0h-.75V7.5H15V9z" clipRule="evenodd" />
    </svg>
);


export const VEO_LOADING_MESSAGES = [
    "Warming up the video synthesizers...",
    "Teaching pixels to dance...",
    "Compositing your visual masterpiece...",
    "Rendering cinematic vibes...",
    "This can take a minute, great art needs patience!",
    "Finalizing the visual symphony...",
];

export const PIANO_NOTES = [
    { note: 'C4', freq: 261.63, key: 'a', type: 'white' },
    { note: 'C#4', freq: 277.18, key: 'w', type: 'black' },
    { note: 'D4', freq: 293.66, key: 's', type: 'white' },
    { note: 'D#4', freq: 311.13, key: 'e', type: 'black' },
    { note: 'E4', freq: 329.63, key: 'd', type: 'white' },
    { note: 'F4', freq: 349.23, key: 'f', type: 'white' },
    { note: 'F#4', freq: 369.99, key: 't', type: 'black' },
    { note: 'G4', freq: 392.00, key: 'g', type: 'white' },
    { note: 'G#4', freq: 415.30, key: 'y', type: 'black' },
    { note: 'A4', freq: 440.00, key: 'h', type: 'white' },
    { note: 'A#4', freq: 466.16, key: 'u', type: 'black' },
    { note: 'B4', freq: 493.88, key: 'j', type: 'white' },
    { note: 'C5', freq: 523.25, key: 'k', type: 'white' },
];