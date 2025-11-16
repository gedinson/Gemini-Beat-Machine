
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
// Fix: Import necessary types and classes from @google/genai for Live API implementation.
import { GoogleGenAI, LiveServerMessage, LiveSession, Modality, Type, FunctionDeclaration, Blob as GenAI_Blob } from '@google/genai';
import { Instrument, GridState, View, GroundingChunk, BeatPattern, Recording, AllMixerSettings } from './types';
import { INSTRUMENTS, NUM_STEPS, NUM_TRACKS, IconSpark, IconSearch, IconMic, IconMusicNote, IconRecord, IconKeyboard, PIANO_NOTES } from './constants';
import * as geminiService from './services/geminiService';

// Fix: Add audio encoding/decoding utilities as per Gemini API guidelines.
function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}


// Audio Utilities
const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
const sequencerMasterGain = audioContext.createGain();
sequencerMasterGain.connect(audioContext.destination);


// --- Main Application ---

type MixerChannel = {
    gain: GainNode;
    pan: StereoPannerNode;
    bass: BiquadFilterNode;
    mid: BiquadFilterNode;
    reverbSend: GainNode;
};

export default function App() {
    const [view, setView] = useState<View>('sequencer');
    const [grid, setGrid] = useState<GridState>(() => Array.from({ length: NUM_TRACKS }, () => Array(NUM_STEPS).fill(0)));
    const [isPlaying, setIsPlaying] = useState(false);
    const [tempo, setTempo] = useState(120);
    const [currentStep, setCurrentStep] = useState<number | null>(null);
    const timerRef = useRef<number | null>(null);

    // AI Feature States
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState<{ text: string; groundingChunks: GroundingChunk[] } | null>(null);

    // Live API states
    const [isLiveConnected, setIsLiveConnected] = useState(false);
    const [liveStatus, setLiveStatus] = useState("Inactive");
    const sessionRef = useRef<LiveSession | null>(null);
    const audioStreamRef = useRef<MediaStream | null>(null);
    const outputAudioContext = useRef<AudioContext | null>(null);
    const nextStartTime = useRef(0);
    const sources = useRef(new Set<AudioBufferSourceNode>());

    // Mic, Piano & Recording states
    const [micStream, setMicStream] = useState<MediaStream | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [recordings, setRecordings] = useState<Recording[]>([]);
    const [micFx, setMicFx] = useState({ distortion: 0, delayTime: 0, delayFeedback: 0, reverb: 0 });
    const [pianoInstrument, setPianoInstrument] = useState<Instrument>('Pianos');
    const audioFxNodes = useRef<any>({});
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const mediaStreamDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>();
    
    // Mixer State
    const initialMixerSettings: AllMixerSettings = useMemo(() => INSTRUMENTS.reduce((acc, inst) => {
        acc[inst] = { volume: 0.8, pan: 0, eq: { bass: 0, mid: 0 }, sustain: 0.2, reverb: 0 };
        return acc;
    }, {} as AllMixerSettings), []);
    const [mixerSettings, setMixerSettings] = useState<AllMixerSettings>(initialMixerSettings);
    const mixerChannels = useRef<Record<Instrument, MixerChannel>>({} as Record<Instrument, MixerChannel>);
    const mixerSettingsRef = useRef(mixerSettings);
    const masterReverb = useRef<ConvolverNode | null>(null);


    useEffect(() => {
        mixerSettingsRef.current = mixerSettings;
    }, [mixerSettings]);
    
    // Initialize Mixer Audio Nodes
    useEffect(() => {
        // Create a single master reverb effect if it doesn't exist
        if (!masterReverb.current) {
            const reverb = audioContext.createConvolver();
            reverb.buffer = createReverbImpulseResponse(); // Reuse this function
            reverb.connect(sequencerMasterGain);
            masterReverb.current = reverb;
        }

        INSTRUMENTS.forEach(inst => {
            const gain = audioContext.createGain();
            const pan = audioContext.createStereoPanner();
            const reverbSend = audioContext.createGain();
            reverbSend.gain.value = 0; // Start with no reverb
            
            const bass = audioContext.createBiquadFilter();
            bass.type = 'lowshelf';
            bass.frequency.value = 250;

            const mid = audioContext.createBiquadFilter();
            mid.type = 'peaking';
            mid.frequency.value = 1000;
            mid.Q.value = 1;

            // Post-fader send routing:
            // Signal chain: bass -> mid -> pan -> gain (main volume)
            bass.connect(mid).connect(pan).connect(gain);
            
            // From the main gain, split the signal
            // Dry path: gain -> master out
            gain.connect(sequencerMasterGain);
            
            // Wet (reverb) path: gain -> reverbSend -> masterReverb
            gain.connect(reverbSend).connect(masterReverb.current!);


            mixerChannels.current[inst] = { gain, pan, bass, mid, reverbSend };
        });
    }, []);

    // Update mixer nodes when settings change
    useEffect(() => {
        const now = audioContext.currentTime;
        INSTRUMENTS.forEach(inst => {
            const settings = mixerSettings[inst];
            const channel = mixerChannels.current[inst];
            if (channel) {
                channel.gain.gain.setValueAtTime(settings.volume, now);
                channel.pan.pan.setValueAtTime(settings.pan, now);
                channel.bass.gain.setValueAtTime(settings.eq.bass, now);
                channel.mid.gain.setValueAtTime(settings.eq.mid, now);
                channel.reverbSend.gain.setValueAtTime(settings.reverb, now);
            }
        });
    }, [mixerSettings]);


    const soundPlayer: Record<Instrument, (pitch: number) => void> = useMemo(() => {
        const createSound = (instrument: Instrument, setup: (now: number, pitch: number, channelInput: AudioNode, sustain: number) => void) => (pitch: number) => {
            const now = audioContext.currentTime;
            const channelInput = mixerChannels.current[instrument].bass;
            const sustain = mixerSettingsRef.current[instrument].sustain;
            if (channelInput) {
                setup(now, pitch, channelInput, sustain);
            }
        };

        return {
            'Kick': createSound('Kick', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = Math.max(0.05, (0.05 + sustain * 0.4) / pitch);
                osc.frequency.setValueAtTime(150 * pitch, now);
                osc.frequency.exponentialRampToValueAtTime(0.01, now + duration);
                gain.gain.setValueAtTime(1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                osc.connect(gain).connect(dest);
                osc.start(now);
                osc.stop(now + duration);
            }),
            'Snare': createSound('Snare', (now, pitch, dest, sustain) => {
                const noise = audioContext.createBufferSource();
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const output = buffer.getChannelData(0);
                for (let i = 0; i < audioContext.sampleRate; i++) output[i] = Math.random() * 2 - 1;
                noise.buffer = buffer;
                noise.playbackRate.value = pitch;
                const noiseFilter = audioContext.createBiquadFilter();
                noiseFilter.type = 'highpass';
                noiseFilter.frequency.value = 1000 * pitch;
                const noiseEnvelope = audioContext.createGain();
                const duration = Math.max(0.05, (0.05 + sustain * 0.3) / pitch);
                noiseEnvelope.gain.setValueAtTime(1, now);
                noiseEnvelope.gain.exponentialRampToValueAtTime(0.01, now + duration);
                noise.connect(noiseFilter).connect(noiseEnvelope).connect(dest);
                noise.start(now);
                noise.stop(now + duration);
            }),
             'Hi-hat (Closed)': createSound('Hi-hat (Closed)', (now, pitch, dest, sustain) => createHihat(false, pitch, dest, sustain)),
             'Hi-hat (Open)': createSound('Hi-hat (Open)', (now, pitch, dest, sustain) => createHihat(true, pitch, dest, sustain)),
             'Clap': createSound('Clap', (now, pitch, dest, sustain) => {
                const noise = audioContext.createBufferSource();
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const output = buffer.getChannelData(0);
                for (let i = 0; i < audioContext.sampleRate; i++) output[i] = Math.random() * 2 - 1;
                noise.buffer = buffer;
                noise.playbackRate.value = pitch;
                const bandpass = audioContext.createBiquadFilter();
                bandpass.type = 'bandpass';
                bandpass.frequency.value = 2500 * pitch;
                bandpass.Q.value = 1.0;
                const envelope = audioContext.createGain();
                const duration = 0.05 + sustain * 0.2;
                envelope.gain.setValueAtTime(0, now);
                envelope.gain.linearRampToValueAtTime(0.8, now + 0.005 / pitch);
                envelope.gain.linearRampToValueAtTime(0, now + 0.01 / pitch);
                envelope.gain.linearRampToValueAtTime(0.8, now + 0.015 / pitch);
                envelope.gain.linearRampToValueAtTime(0, now + 0.02 / pitch);
                envelope.gain.linearRampToValueAtTime(0.6, now + 0.025 / pitch);
                envelope.gain.exponentialRampToValueAtTime(0.01, now + duration / pitch);
                noise.connect(bandpass).connect(envelope).connect(dest);
                noise.start(now);
                noise.stop(now + (duration + 0.05) / pitch);
            }),
            'Tom': createSound('Tom', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = Math.max(0.08, (0.1 + sustain * 0.4) / pitch);
                osc.frequency.setValueAtTime(300 * pitch, now);
                osc.frequency.exponentialRampToValueAtTime(100 * pitch, now + duration);
                gain.gain.setValueAtTime(0.8, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                osc.connect(gain).connect(dest);
                osc.start(now);
                osc.stop(now + duration);
            }),
            'Rimshot': createSound('Rimshot', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = (0.03 + sustain * 0.05) / pitch;
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1000 * pitch, now);
                osc.frequency.exponentialRampToValueAtTime(400 * pitch, now + duration);
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                osc.connect(gain).connect(dest);
                osc.start(now);
                osc.stop(now + duration);
            }),
            'Cowbell': createSound('Cowbell', (now, pitch, dest, sustain) => {
                const osc1 = audioContext.createOscillator();
                const osc2 = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = (0.05 + sustain * 0.4) / pitch;
                osc1.type = 'square';
                osc2.type = 'square';
                osc1.frequency.value = 540 * pitch;
                osc2.frequency.value = 810 * pitch;
                gain.gain.setValueAtTime(0.3, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(dest);
                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + duration);
                osc2.stop(now + duration);
            }),
            'Cymbal': createSound('Cymbal', (now, pitch, dest, sustain) => {
                const noise = audioContext.createBufferSource();
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate * 2, audioContext.sampleRate);
                const output = buffer.getChannelData(0);
                for (let i = 0; i < audioContext.sampleRate * 2; i++) output[i] = Math.random() * 2 - 1;
                noise.buffer = buffer;
                noise.playbackRate.value = pitch;
                const bandpass = audioContext.createBiquadFilter();
                bandpass.type = 'bandpass';
                bandpass.frequency.value = 12000 * pitch;
                bandpass.Q.value = 0.5;
                const highpass = audioContext.createBiquadFilter();
                highpass.type = "highpass";
                highpass.frequency.value = 5000 * pitch;
                const gain = audioContext.createGain();
                const duration = (0.2 + sustain * 2.5) / pitch;
                gain.gain.setValueAtTime(0.5, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                noise.connect(bandpass).connect(highpass).connect(gain).connect(dest);
                noise.start(now);
                noise.stop(now + duration);
            }),
            'Shaker': createSound('Shaker', (now, pitch, dest, sustain) => {
                const noise = audioContext.createBufferSource();
                const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
                const output = buffer.getChannelData(0);
                for (let i = 0; i < audioContext.sampleRate; i++) output[i] = Math.random() * 2 - 1;
                noise.buffer = buffer;
                noise.playbackRate.value = pitch;
                const bandpass = audioContext.createBiquadFilter();
                bandpass.type = 'bandpass';
                bandpass.frequency.value = 8000 * pitch;
                bandpass.Q.value = 2;
                const gain = audioContext.createGain();
                const duration = (0.05 + sustain * 0.1) / pitch;
                gain.gain.setValueAtTime(0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                noise.connect(bandpass).connect(gain).connect(dest);
                noise.start(now);
                noise.stop(now + duration);
            }),
            '808': createSound('808', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = (0.1 + sustain * 4) / pitch;
                osc.type = 'sine';
                osc.frequency.setValueAtTime(120 * pitch, now);
                osc.frequency.exponentialRampToValueAtTime(30 * pitch, now + 0.1);
                gain.gain.setValueAtTime(1, now);
                gain.gain.linearRampToValueAtTime(1, now + 0.01);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
                osc.connect(gain).connect(dest);
                osc.start(now);
                osc.stop(now + duration);
            }),
            'Congas': createSound('Congas', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const duration = (0.1 + sustain * 0.5) / pitch;
                osc.type = 'sine';
                osc.frequency.setValueAtTime(440 * pitch, now);
                osc.frequency.exponentialRampToValueAtTime(220 * pitch, now + duration);
                gain.gain.setValueAtTime(1, now);
                gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
                osc.connect(gain).connect(dest);
                osc.start(now);
                osc.stop(now + duration);
            }),
            'Violin': createSound('Violin', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const lfo = audioContext.createOscillator();
                const vibrato = audioContext.createGain();
                const baseFreq = 261.63; // C4
                const duration = (0.2 + sustain * 1.8) / pitch;
                osc.type = 'sawtooth';
                osc.frequency.value = baseFreq * pitch;
                lfo.frequency.value = 5;
                vibrato.gain.value = 4;
                lfo.connect(vibrato);
                vibrato.connect(osc.detune);
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.5, now + 0.1 / pitch);
                gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.connect(gain).connect(dest);
                lfo.start(now);
                osc.start(now);
                lfo.stop(now + duration);
                osc.stop(now + duration);
            }),
            'Trumpet': createSound('Trumpet', (now, pitch, dest, sustain) => {
                const osc = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const filter = audioContext.createBiquadFilter();
                const baseFreq = 261.63; // C4
                const duration = (0.1 + sustain * 0.8) / pitch;
                osc.type = 'sawtooth';
                osc.frequency.value = baseFreq * pitch;
                filter.type = 'lowpass';
                filter.frequency.value = 1500 * pitch;
                filter.Q.value = 5;
                gain.gain.setValueAtTime(0, now);
                gain.gain.linearRampToValueAtTime(0.8, now + 0.05 / pitch);
                gain.gain.exponentialRampToValueAtTime(0.1, now + 0.2 / pitch);
                gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
                osc.connect(filter).connect(gain).connect(dest);
                osc.start(now);
                osc.stop(now + duration);
            }),
            'Pianos': createSound('Pianos', (now, pitch, dest, sustain) => {
                const baseFreq = 261.63 * pitch; // C4
                const createPart = (freqMultiplier: number, gainValue: number, decay: number) => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    const finalDecay = (decay * (0.2 + sustain * 2.5)) / pitch;
                    osc.type = 'sine';
                    osc.frequency.value = baseFreq * freqMultiplier;
                    gain.gain.setValueAtTime(gainValue, now);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + finalDecay);
                    osc.connect(gain).connect(dest);
                    osc.start(now);
                    osc.stop(now + finalDecay + 0.1);
                };
                createPart(1, 0.4, 2.0);
                createPart(2, 0.2, 1.5);
                createPart(3, 0.1, 1.0);
            }),
            'High Pitch Piano': createSound('High Pitch Piano', (now, pitch, dest, sustain) => {
                const baseFreq = 523.25 * pitch; // C5 (one octave higher)
                const createPart = (freqMultiplier: number, gainValue: number, decay: number) => {
                    const osc = audioContext.createOscillator();
                    const gain = audioContext.createGain();
                    const finalDecay = (decay * (0.2 + sustain * 2.5)) / pitch;
                    osc.type = 'sine';
                    osc.frequency.value = baseFreq * freqMultiplier;
                    gain.gain.setValueAtTime(gainValue, now);
                    gain.gain.exponentialRampToValueAtTime(0.0001, now + finalDecay);
                    osc.connect(gain).connect(dest);
                    osc.start(now);
                    osc.stop(now + finalDecay + 0.1);
                };
                createPart(1, 0.4, 2.0);
                createPart(2, 0.2, 1.5);
                createPart(3, 0.1, 1.0);
            }),
        };
    }, []);

    const createHihat = (isOpen: boolean, pitch: number, dest: AudioNode, sustain: number) => {
        const now = audioContext.currentTime;
        const noise = audioContext.createBufferSource();
        const buffer = audioContext.createBuffer(1, audioContext.sampleRate, audioContext.sampleRate);
        const output = buffer.getChannelData(0);
        for (let i = 0; i < audioContext.sampleRate; i++) output[i] = Math.random() * 2 - 1;
        noise.buffer = buffer;
        noise.playbackRate.value = pitch;
        const bandpass = audioContext.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 10000 * pitch;
        bandpass.Q.value = 1.5;
        const highpass = audioContext.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 7000 * pitch;
        const gain = audioContext.createGain();
        const duration = (isOpen ? (0.1 + sustain * 0.8) : (0.02 + sustain * 0.08)) / pitch;
        gain.gain.setValueAtTime(1, now);
        gain.gain.exponentialRampToValueAtTime(0.01, now + duration);
        noise.connect(bandpass).connect(highpass).connect(gain).connect(dest);
        noise.start(now);
        noise.stop(now + duration);
    };

    const cycleStepPitch = useCallback((track: number, step: number) => {
        setGrid(prevGrid => {
            const newGrid = prevGrid.map(t => [...t]);
            const currentPitch = newGrid[track][step];
            newGrid[track][step] = (currentPitch + 1) % 10; // Cycles 0-9
            return newGrid;
        });
    }, []);

    const clearTrack = (trackIndex: number) => {
        setGrid(prevGrid => {
            const newGrid = prevGrid.map(t => [...t]);
            newGrid[trackIndex] = Array(NUM_STEPS).fill(0);
            return newGrid;
        });
    }
    
    const clearAll = useCallback(() => {
        setGrid(Array.from({ length: NUM_TRACKS }, () => Array(NUM_STEPS).fill(0)));
    }, []);

    const setSteps = useCallback((trackName: string, steps: number[]) => {
        const trackIndex = INSTRUMENTS.findIndex(inst => inst.toLowerCase().includes(trackName.toLowerCase()));
        if (trackIndex === -1) return;
        
        setGrid(prevGrid => {
            const newGrid = prevGrid.map(t => [...t]);
            const newTrack = Array(NUM_STEPS).fill(0);
            steps.forEach(step => {
                if(step >= 1 && step <= NUM_STEPS) {
                    newTrack[step-1] = 5; // Set to a default middle pitch (5)
                }
            });
            newGrid[trackIndex] = newTrack;
            return newGrid;
        });
    }, []);

    const handlePlay = useCallback(() => {
        if (isPlaying) return;
        audioContext.resume();
        setIsPlaying(true);
    }, [isPlaying]);

    const handleStop = useCallback(() => {
        if (!isPlaying) return;
        setIsPlaying(false);
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
        setCurrentStep(null);
    }, [isPlaying]);

    const mapPitchValue = (value: number) => {
        if (value <= 0) return 1.0;
        const minPitch = 0.5;
        const maxPitch = 2.0;
        // Maps pitch value 1-9 to range 0.5-2.0
        return minPitch + ((value - 1) / 8) * (maxPitch - minPitch);
    };

    useEffect(() => {
        if (isPlaying) {
            const interval = 60000 / tempo / 4; // 16th notes
            timerRef.current = window.setInterval(() => {
                setCurrentStep(prev => {
                    const nextStep = (prev === null ? 0 : prev + 1) % NUM_STEPS;
                    grid.forEach((track, trackIndex) => {
                        const pitchValue = track[nextStep];
                        if (pitchValue > 0) {
                            const pitch = mapPitchValue(pitchValue);
                            soundPlayer[INSTRUMENTS[trackIndex]](pitch);
                        }
                    });
                    return nextStep;
                });
            }, interval);
        } else if (timerRef.current) {
            clearInterval(timerRef.current);
        }
        return () => {
            if (timerRef.current) clearInterval(timerRef.current);
        };
    }, [isPlaying, tempo, grid, soundPlayer]);

    // --- Gemini Feature Handlers ---

    const handleGenerateBeat = async () => {
        if (!aiPrompt) return;
        setIsGenerating(true);
        try {
            const pattern = await geminiService.generateBeatPattern(aiPrompt);
            if (pattern) {
                const newGrid = INSTRUMENTS.map(instrument => {
                    const trackPattern = pattern[instrument as Instrument];
                    // Convert AI's 0/1 to 0/5 (default middle pitch)
                    return trackPattern ? trackPattern.map(step => step === 1 ? 5 : 0) : Array(NUM_STEPS).fill(0);
                });
                setGrid(newGrid);
            }
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleSearch = async () => {
        if (!searchQuery) return;
        setIsGenerating(true);
        setSearchResult(null);
        try {
            const result = await geminiService.searchMusicInfo(searchQuery);
            setSearchResult(result);
        } finally {
            setIsGenerating(false);
        }
    };

    const startLiveSession = async () => {
        if (isLiveConnected) return;
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            audioStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
            setLiveStatus("Connecting...");

            if (!outputAudioContext.current) {
                outputAudioContext.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            }

            const controlFunctionDeclarations: FunctionDeclaration[] = [
                { name: 'play', parameters: { type: Type.OBJECT, properties: {} } },
                { name: 'stop', parameters: { type: Type.OBJECT, properties: {} } },
                { name: 'setTempo', parameters: { type: Type.OBJECT, properties: { tempo: { type: Type.INTEGER, description: 'The tempo in BPM, e.g., 120' } }, required: ['tempo'] } },
                { name: 'clearAll', parameters: { type: Type.OBJECT, properties: {} } },
                { name: 'clearTrack', parameters: { type: Type.OBJECT, properties: { trackName: { type: Type.STRING, description: 'The name of the track to clear, e.g., "Kick"' } }, required: ['trackName'] } },
                { name: 'setSteps', parameters: {
                    type: Type.OBJECT,
                    properties: {
                        trackName: { type: Type.STRING, description: 'The name of the track, e.g., "Snare"' },
                        steps: { type: Type.ARRAY, description: `An array of step numbers to activate, from 1 to 32`, items: { type: Type.INTEGER } }
                    },
                    required: ['trackName', 'steps']
                }},
            ];

            let sessionPromise: Promise<LiveSession>;

            const callbacks = {
                onopen: () => {
                    setIsLiveConnected(true);
                    setLiveStatus("Connected. Speak now!");
                    
                    const inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
                    const source = inputAudioContext.createMediaStreamSource(audioStreamRef.current!);
                    const scriptProcessor = inputAudioContext.createScriptProcessor(4096, 1, 1);
                    scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
                        const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
                        const l = inputData.length;
                        const int16 = new Int16Array(l);
                        for (let i = 0; i < l; i++) { int16[i] = inputData[i] * 32768; }
                        
                        const pcmBlob: GenAI_Blob = {
                            data: encode(new Uint8Array(int16.buffer)),
                            mimeType: 'audio/pcm;rate=16000',
                        };
                        
                        sessionPromise.then((session) => {
                            session.sendRealtimeInput({ media: pcmBlob });
                        });
                    };
                    source.connect(scriptProcessor);
                    scriptProcessor.connect(inputAudioContext.destination);
                },
                onmessage: async (message: LiveServerMessage) => {
                    if (message.toolCall) {
                        for (const fc of message.toolCall.functionCalls) {
                            let result = "Function not found";
                            const args = fc.args as any;
                            if (fc.name === 'play') {
                                handlePlay();
                                result = "Playback started";
                            } else if (fc.name === 'stop') {
                                handleStop();
                                result = "Playback stopped";
                            } else if (fc.name === 'setTempo' && args.tempo) {
                                setTempo(args.tempo);
                                result = `Tempo set to ${args.tempo} BPM`;
                            } else if (fc.name === 'clearAll') {
                                clearAll();
                                result = "Grid cleared";
                            } else if (fc.name === 'clearTrack' && args.trackName) {
                                const trackIndex = INSTRUMENTS.findIndex(i => i.toLowerCase().includes(args.trackName.toLowerCase()));
                                if(trackIndex !== -1) {
                                    clearTrack(trackIndex);
                                    result = `Cleared ${INSTRUMENTS[trackIndex]} track`;
                                }
                            } else if (fc.name === 'setSteps' && args.trackName && args.steps) {
                                setSteps(args.trackName, args.steps);
                                result = `Set steps for ${args.trackName}`;
                            }

                            sessionPromise.then(session => {
                                session.sendToolResponse({
                                    functionResponses: { id: fc.id, name: fc.name, response: { result: result } }
                                })
                            });
                        }
                    }

                    const base64EncodedAudioString = message.serverContent?.modelTurn?.parts[0]?.inlineData.data;
                    if (base64EncodedAudioString && outputAudioContext.current) {
                        const ctx = outputAudioContext.current;
                        nextStartTime.current = Math.max(
                          nextStartTime.current,
                          ctx.currentTime,
                        );
                        const audioBuffer = await decodeAudioData(
                          decode(base64EncodedAudioString),
                          ctx,
                          24000,
                          1,
                        );
                        const source = ctx.createBufferSource();
                        source.buffer = audioBuffer;
                        source.connect(ctx.destination); // Connect to the output
                        source.addEventListener('ended', () => {
                          sources.current.delete(source);
                        });
                
                        source.start(nextStartTime.current);
                        nextStartTime.current = nextStartTime.current + audioBuffer.duration;
                        sources.current.add(source);
                    }

                    if (message.serverContent?.interrupted) {
                        for (const source of sources.current.values()) {
                            source.stop();
                        }
                        sources.current.clear();
                        nextStartTime.current = 0;
                    }
                },
                onerror: (e: ErrorEvent) => {
                    console.error('Live session error:', e);
                    setLiveStatus("Error. Please try again.");
                    setIsLiveConnected(false);
                },
                onclose: (e: CloseEvent) => {
                    setIsLiveConnected(false);
                    setLiveStatus("Inactive");
                    audioStreamRef.current?.getTracks().forEach(track => track.stop());
                },
            };
            
            sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                callbacks: callbacks,
                config: {
                    responseModalities: [Modality.AUDIO],
                    speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
                    tools: [{ functionDeclarations: controlFunctionDeclarations }],
                    systemInstruction: "You are a helpful assistant controlling a beat machine. Respond to user commands concisely. When a command is successfully executed via a function call, a simple 'Okay' or 'Done' is sufficient. Guide the user if their command is unclear.",
                },
            });
            sessionRef.current = await sessionPromise;
        } catch (error) {
            console.error('Failed to start live session:', error);
            setLiveStatus("Mic access denied or error.");
        }
    };

    const stopLiveSession = () => {
        sessionRef.current?.close();
        for (const source of sources.current.values()) {
            source.stop();
        }
        sources.current.clear();
        nextStartTime.current = 0;
    };

    // --- Piano Handler ---
    const playPianoNote = useCallback((frequency: number) => {
        const soundGenerator = soundPlayer[pianoInstrument];
        if (soundGenerator) {
            // Use C4 (261.63 Hz) as the base frequency for a pitch of 1.0
            const baseFrequency = 261.63;
            const pitch = frequency / baseFrequency;
            soundGenerator(pitch);
        }
    }, [pianoInstrument, soundPlayer]);

    // --- Mic & Recording Handlers ---
    const startMic = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            setMicStream(stream);
            
            const source = audioContext.createMediaStreamSource(stream);
            const distortion = audioContext.createWaveShaper();
            const delay = audioContext.createDelay(5.0);
            const feedback = audioContext.createGain();
            const reverb = audioContext.createConvolver();
            const reverbGain = audioContext.createGain();
            const analyser = audioContext.createAnalyser();

            distortion.curve = makeDistortionCurve(micFx.distortion);
            distortion.oversample = '4x';
            delay.delayTime.value = micFx.delayTime;
            feedback.gain.value = micFx.delayFeedback;
            reverbGain.gain.value = micFx.reverb;
            const dryGain = audioContext.createGain();
            dryGain.gain.value = 1 - micFx.reverb;

            reverb.buffer = createReverbImpulseResponse();

            source.connect(distortion);
            distortion.connect(delay);
            delay.connect(feedback);
            feedback.connect(delay);
            
            distortion.connect(dryGain);
            dryGain.connect(analyser);

            delay.connect(reverb);
            reverb.connect(reverbGain);
            reverbGain.connect(analyser);

            analyser.connect(audioContext.destination);

            audioFxNodes.current = { source, distortion, delay, feedback, reverb, reverbGain, dryGain, analyser };
        } catch (err) {
            console.error("Mic access denied:", err);
            alert("Microphone access was denied. Please allow microphone access in your browser settings.");
        }
    };
    
    const stopMic = () => {
        micStream?.getTracks().forEach(track => track.stop());
        Object.values(audioFxNodes.current).forEach((node: any) => node.disconnect());
        setMicStream(null);
        if (animationFrameRef.current) {
            cancelAnimationFrame(animationFrameRef.current);
        }
    };

    const startRecording = () => {
        setIsRecording(true);
        const dest = audioContext.createMediaStreamDestination();
        mediaStreamDestination.current = dest;
        mediaRecorder.current = new MediaRecorder(dest.stream);

        // Connect all active sound sources to the recording destination
        sequencerMasterGain.connect(dest);
        if (micStream && audioFxNodes.current.analyser) {
            audioFxNodes.current.analyser.connect(dest);
        }

        const chunks: Blob[] = [];
        mediaRecorder.current.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorder.current.onstop = () => {
            const blob = new Blob(chunks, { type: 'audio/wav' });
            const url = URL.createObjectURL(blob);
            const name = `Recording-${new Date().toLocaleString()}.wav`;
            setRecordings(prev => [...prev, { name, url, blob }]);

            // Clean up connections after recording stops
            const destNode = mediaStreamDestination.current;
            if (destNode) {
                sequencerMasterGain.disconnect(destNode);
                if (micStream && audioFxNodes.current.analyser) {
                     audioFxNodes.current.analyser.disconnect(destNode);
                }
            }
            mediaStreamDestination.current = null;
        };

        mediaRecorder.current.start();
    };

    const stopRecording = () => {
        if(isRecording) {
            mediaRecorder.current?.stop();
            setIsRecording(false);
        }
    };
    
    const makeDistortionCurve = (amount: number) => {
        const k = typeof amount === 'number' ? amount : 0;
        const n_samples = 44100;
        const curve = new Float32Array(n_samples);
        const deg = Math.PI / 180;
        for (let i = 0; i < n_samples; ++i) {
            const x = i * 2 / n_samples - 1;
            curve[i] = (3 + k) * x * 20 * deg / (Math.PI + k * Math.abs(x));
        }
        return curve;
    };
    
    const createReverbImpulseResponse = () => {
        const rate = audioContext.sampleRate;
        const length = rate * 2;
        const impulse = audioContext.createBuffer(2, length, rate);
        const left = impulse.getChannelData(0);
        const right = impulse.getChannelData(1);
        for (let i = 0; i < length; i++) {
            left[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
            right[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
        }
        return impulse;
    };
    
    useEffect(() => {
        if (audioFxNodes.current.distortion) {
            audioFxNodes.current.distortion.curve = makeDistortionCurve(micFx.distortion);
            audioFxNodes.current.delay.delayTime.setValueAtTime(micFx.delayTime, audioContext.currentTime);
            audioFxNodes.current.feedback.gain.setValueAtTime(micFx.delayFeedback, audioContext.currentTime);
            audioFxNodes.current.reverbGain.gain.setValueAtTime(micFx.reverb, audioContext.currentTime);
            audioFxNodes.current.dryGain.gain.setValueAtTime(1 - micFx.reverb, audioContext.currentTime);
        }
    }, [micFx]);

    useEffect(() => {
        const draw = () => {
            if (!canvasRef.current || !audioFxNodes.current.analyser) return;
            const analyser = audioFxNodes.current.analyser;
            const canvas = canvasRef.current;
            const ctx = canvas.getContext('2d');
            if (!ctx) return;
            
            analyser.fftSize = 2048;
            const bufferLength = analyser.frequencyBinCount;
            const dataArray = new Uint8Array(bufferLength);
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            analyser.getByteTimeDomainData(dataArray);

            ctx.lineWidth = 2;
            ctx.strokeStyle = '#67e8f9'; // cyan-300
            ctx.beginPath();
            const sliceWidth = canvas.width * 1.0 / bufferLength;
            let x = 0;
            for (let i = 0; i < bufferLength; i++) {
                const v = dataArray[i] / 128.0;
                const y = v * canvas.height / 2;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            ctx.lineTo(canvas.width, canvas.height / 2);
            ctx.stroke();
            animationFrameRef.current = requestAnimationFrame(draw);
        };
        if(micStream) {
            draw();
        }
        return () => {
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        }
    }, [micStream]);
    
    const handleMixerChange = (instrument: Instrument, key: 'volume' | 'pan' | 'sustain' | 'reverb', value: number) => {
        setMixerSettings(prev => ({
            ...prev,
            [instrument]: { ...prev[instrument], [key]: value }
        }));
    };
    
    const handleEqChange = (instrument: Instrument, band: 'bass' | 'mid', value: number) => {
        setMixerSettings(prev => ({
            ...prev,
            [instrument]: { ...prev[instrument], eq: { ...prev[instrument].eq, [band]: value } }
        }));
    };

    // --- Components ---

    const renderView = () => {
        const commonInputClass = "w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-400 focus:outline-none transition";
        const commonButtonClass = "w-full p-3 bg-cyan-500 text-white font-bold rounded-lg hover:bg-cyan-600 transition disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2";

        switch (view) {
             case 'piano':
                return (
                    <div className="space-y-4">
                        <div className="text-center">
                            <h2 className="text-2xl font-bold text-cyan-300">Virtual Piano</h2>
                            <p className="text-gray-400">Click or use your keyboard to play (Keys: A, W, S, E, D...)</p>
                        </div>
                        <div className="flex justify-center items-center gap-3">
                            <label htmlFor="piano-instrument" className="font-bold">Instrument:</label>
                             <select
                                id="piano-instrument"
                                value={pianoInstrument}
                                onChange={(e) => setPianoInstrument(e.target.value as Instrument)}
                                className="bg-gray-700 border border-gray-600 rounded-lg p-2 focus:ring-2 focus:ring-cyan-400 focus:outline-none"
                            >
                                {INSTRUMENTS.map(inst => (
                                    <option key={inst} value={inst}>{inst}</option>
                                ))}
                            </select>
                        </div>
                        <div className="p-4 bg-gray-900 rounded-lg">
                           <PianoKeyboard playPianoNote={playPianoNote} />
                        </div>
                    </div>
                );
            case 'fx':
                return (
                    <div className="space-y-6">
                         <h2 className="text-2xl font-bold text-cyan-300">FX & Recording Studio</h2>
                         <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                            {/* Mic Controls */}
                            <div className="bg-gray-800 p-4 rounded-lg space-y-4">
                                <h3 className="font-bold text-lg">Live Microphone</h3>
                                <button onClick={micStream ? stopMic : startMic} className={`w-full p-3 text-white font-bold rounded-lg transition flex items-center justify-center gap-2 ${micStream ? 'bg-red-500 hover:bg-red-600' : 'bg-green-500 hover:bg-green-600'}`}>
                                    <IconMic/> {micStream ? 'Stop Mic' : 'Start Mic'}
                                </button>
                                <canvas ref={canvasRef} className="w-full h-24 bg-black rounded-md" width="300" height="100"></canvas>
                                <div className="space-y-3 pt-2">
                                    {/* FX Sliders */}
                                    <div className="text-sm">
                                        <label className="block mb-1">Distortion: {Math.round(micFx.distortion / 10)}%</label>
                                        <input type="range" min="0" max="1000" value={micFx.distortion} onChange={e => setMicFx(s => ({...s, distortion: +e.target.value}))} className="w-full" disabled={!micStream} />
                                    </div>
                                    <div className="text-sm">
                                        <label className="block mb-1">Echo Time: {micFx.delayTime.toFixed(2)}s</label>
                                        <input type="range" min="0" max="2" step="0.01" value={micFx.delayTime} onChange={e => setMicFx(s => ({...s, delayTime: +e.target.value}))} className="w-full" disabled={!micStream} />
                                    </div>
                                    <div className="text-sm">
                                        <label className="block mb-1">Echo Feedback: {Math.round(micFx.delayFeedback * 100)}%</label>
                                        <input type="range" min="0" max="0.8" step="0.01" value={micFx.delayFeedback} onChange={e => setMicFx(s => ({...s, delayFeedback: +e.target.value}))} className="w-full" disabled={!micStream} />
                                    </div>
                                     <div className="text-sm">
                                        <label className="block mb-1">Reverb: {Math.round(micFx.reverb * 100)}%</label>
                                        <input type="range" min="0" max="1" step="0.01" value={micFx.reverb} onChange={e => setMicFx(s => ({...s, reverb: +e.target.value}))} className="w-full" disabled={!micStream} />
                                    </div>
                                </div>
                            </div>
                            {/* Recording Controls */}
                             <div className="bg-gray-800 p-4 rounded-lg space-y-4">
                                <h3 className="font-bold text-lg">Recording</h3>
                                <button onClick={isRecording ? stopRecording : startRecording} className={`w-full p-3 text-white font-bold rounded-lg transition flex items-center justify-center gap-2 ${isRecording ? 'bg-red-500 hover:bg-red-600 animate-pulse' : 'bg-cyan-500 hover:bg-cyan-600'}`}>
                                   <IconRecord/> {isRecording ? 'Stop Recording' : 'Record Performance'}
                                </button>
                                <div className="space-y-2 h-64 overflow-y-auto">
                                    {recordings.length === 0 && <p className="text-gray-400 text-center pt-8">No recordings yet.</p>}
                                    {recordings.map((rec, i) => (
                                        <div key={i} className="bg-gray-700 p-2 rounded-md flex items-center justify-between">
                                            <p className="text-sm truncate flex-1">{rec.name}</p>
                                            <audio src={rec.url} controls className="h-8 w-48 mx-2"></audio>
                                            <a href={rec.url} download={rec.name} className="p-2 bg-cyan-600 rounded hover:bg-cyan-500" title="Download">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5"><path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" /><path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" /></svg>
                                            </a>
                                        </div>
                                    ))}
                                </div>
                            </div>
                         </div>
                    </div>
                );
            case 'search':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold text-cyan-300">Music Production Search</h2>
                        <div className="flex gap-2">
                           <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Ask about music... e.g., 'What is sidechain compression?'" className={commonInputClass} onKeyDown={(e) => e.key === 'Enter' && handleSearch()} />
                           <button onClick={handleSearch} disabled={isGenerating || !searchQuery} className="p-3 bg-cyan-500 rounded-lg hover:bg-cyan-600 disabled:bg-gray-500"><IconSearch/></button>
                        </div>
                        {isGenerating && <p className="text-center text-cyan-300">Searching...</p>}
                        {searchResult && <div className="p-4 bg-gray-800 rounded-lg space-y-3 text-gray-300"><p className="whitespace-pre-wrap">{searchResult.text}</p>
                            {searchResult.groundingChunks.length > 0 && <div className="pt-2 border-t border-gray-700"><h4 className="font-bold text-sm">Sources:</h4><ul className="list-disc list-inside text-sm">{searchResult.groundingChunks.map((chunk, i) => chunk.web && <li key={i}><a href={chunk.web.uri} target="_blank" rel="noreferrer" className="text-cyan-400 hover:underline">{chunk.web.title}</a></li>)}</ul></div>}
                        </div>}
                    </div>
                );
            case 'live':
                 return (
                    <div className="space-y-4 text-center">
                        <h2 className="text-2xl font-bold text-cyan-300">Live Voice Control</h2>
                        <p className="text-gray-400">Control the beat machine with your voice.</p>
                        <p className={`font-bold ${isLiveConnected ? 'text-green-400' : 'text-yellow-400'}`}>{liveStatus}</p>
                        <div className="flex justify-center">
                            {!isLiveConnected ? 
                                <button onClick={startLiveSession} className="p-4 bg-green-500 text-white rounded-full hover:bg-green-600 transition"><IconMic className="w-8 h-8"/></button> :
                                <button onClick={stopLiveSession} className="p-4 bg-red-500 text-white rounded-full hover:bg-red-600 transition"><IconMic className="w-8 h-8"/></button>
                            }
                        </div>
                        <div className="text-left text-gray-400 bg-gray-800 p-4 rounded-lg text-sm">
                            <h4 className="font-bold text-white mb-2">Example Commands:</h4>
                            <ul className="list-disc list-inside space-y-1">
                                <li>"Start playback" / "Stop"</li>
                                <li>"Set the tempo to 140 BPM"</li>
                                <li>"Clear the kick track" / "Clear everything"</li>
                                <li>"Put a snare on steps 5 and 13"</li>
                            </ul>
                        </div>
                    </div>
                );
            case 'sequencer':
            default:
                return (
                    <div className="space-y-4">
                        <div className="flex flex-col md:flex-row gap-4">
                            <TrackControls clearTrack={clearTrack} />
                            <SequencerGrid grid={grid} currentStep={currentStep} isPlaying={isPlaying} cycleStepPitch={cycleStepPitch} />
                        </div>
                        <div className="bg-gray-800 p-4 rounded-b-lg space-y-4">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-center">
                                <div className="flex gap-2">
                                    <button onClick={handlePlay} className="px-4 py-2 bg-green-500 rounded-md text-white font-bold w-1/2">Play</button>
                                    <button onClick={handleStop} className="px-4 py-2 bg-red-500 rounded-md text-white font-bold w-1/2">Stop</button>
                                </div>
                                <div className="flex items-center gap-2 text-white">
                                    <label htmlFor="tempo" className="font-bold">{tempo} BPM</label>
                                    <input id="tempo" type="range" min="40" max="240" value={tempo} onChange={e => setTempo(Number(e.target.value))} className="w-full" />
                                </div>
                                <div>
                                    <button onClick={clearAll} className="w-full px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-500">Clear Pattern</button>
                                </div>
                            </div>
                            <div className="pt-4 border-t border-gray-700">
                                 <h3 className="text-lg font-bold text-cyan-300 mb-2 flex items-center gap-2"><IconSpark/> AI Beat Generator</h3>
                                 <div className="flex gap-2">
                                     <input type="text" value={aiPrompt} onChange={e => setAiPrompt(e.target.value)} placeholder="Describe a beat... e.g. 'hip hop beat with an open hat and 808'" className={commonInputClass} onKeyDown={e => e.key === 'Enter' && handleGenerateBeat()} />
                                     <button onClick={handleGenerateBeat} disabled={isGenerating || !aiPrompt} className="px-6 py-2 bg-cyan-500 text-white font-bold rounded-lg hover:bg-cyan-600 disabled:bg-gray-500">Generate</button>
                                 </div>
                            </div>
                        </div>
                        { /* Track Mixer */ }
                         <div className="bg-gray-800 p-4 rounded-lg">
                            <h3 className="font-bold text-lg mb-4">Track Mixer</h3>
                            <div className="flex overflow-x-auto space-x-2 pb-4">
                                {INSTRUMENTS.map(inst => (
                                    <div key={inst} className="flex-shrink-0 w-40 bg-gray-900/50 p-3 rounded-lg flex flex-col items-center space-y-2">
                                        <p className="font-bold text-sm truncate w-full text-center">{inst}</p>
                                        <div className="flex-1 flex justify-center items-center gap-2">
                                            { /* Volume */ }
                                            <div className="flex flex-col items-center h-48">
                                                <label className="text-xs text-gray-400">Vol</label>
                                                <input type="range" min="0" max="1.5" step="0.01" value={mixerSettings[inst].volume} onChange={e => handleMixerChange(inst, 'volume', +e.target.value)} className="mixer-slider" style={{'--thumb-color': '#22d3ee'} as React.CSSProperties} />
                                            </div>
                                            { /* EQ */ }
                                            <div className="flex flex-col items-center h-48">
                                                <label className="text-xs text-gray-400">Bass</label>
                                                <input type="range" min="-24" max="12" step="0.1" value={mixerSettings[inst].eq.bass} onChange={e => handleEqChange(inst, 'bass', +e.target.value)} className="mixer-slider" style={{'--thumb-color': '#67e8f9'} as React.CSSProperties} />
                                            </div>
                                            <div className="flex flex-col items-center h-48">
                                                <label className="text-xs text-gray-400">Mid</label>
                                                <input type="range" min="-24" max="12" step="0.1" value={mixerSettings[inst].eq.mid} onChange={e => handleEqChange(inst, 'mid', +e.target.value)} className="mixer-slider" style={{'--thumb-color': '#a5f3fc'} as React.CSSProperties} />
                                            </div>
                                            <div className="flex flex-col items-center h-48">
                                                <label className="text-xs text-gray-400">Sustain</label>
                                                <input type="range" min="0" max="1" step="0.01" value={mixerSettings[inst].sustain} onChange={e => handleMixerChange(inst, 'sustain', +e.target.value)} className="mixer-slider" style={{'--thumb-color': '#cffafe'} as React.CSSProperties} />
                                            </div>
                                             <div className="flex flex-col items-center h-48">
                                                <label className="text-xs text-gray-400">Reverb</label>
                                                <input type="range" min="0" max="1" step="0.01" value={mixerSettings[inst].reverb} onChange={e => handleMixerChange(inst, 'reverb', +e.target.value)} className="mixer-slider" style={{'--thumb-color': '#e0f2fe'} as React.CSSProperties} />
                                            </div>
                                        </div>
                                        { /* Pan */ }
                                         <div className="w-full">
                                            <label className="text-xs text-gray-400">Pan</label>
                                            <input type="range" min="-1" max="1" step="0.01" value={mixerSettings[inst].pan} onChange={e => handleMixerChange(inst, 'pan', +e.target.value)} className="w-full" />
                                         </div>
                                    </div>
                                ))}
                            </div>
                         </div>
                    </div>
                );
        }
    };

    return (
        <div className="min-h-screen text-white p-2 sm:p-4 lg:p-8 flex flex-col items-center">
             <style>{`
                .mixer-slider {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 1rem;
                    height: 100%;
                    background: #374151; /* gray-700 */
                    outline: none;
                    border-radius: 8px;
                    writing-mode: bt-lr; /* IE */
                    -webkit-appearance: slider-vertical; /* WebKit */
                }
                .mixer-slider::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 24px;
                    height: 24px;
                    background: var(--thumb-color, #67e8f9); /* cyan-300 */
                    cursor: pointer;
                    border-radius: 50%;
                    border: 2px solid #1f2937; /* gray-800 */
                }
                .mixer-slider::-moz-range-thumb {
                    width: 24px;
                    height: 24px;
                    background: var(--thumb-color, #67e8f9); /* cyan-300 */
                    cursor: pointer;
                    border-radius: 50%;
                    border: 2px solid #1f2937; /* gray-800 */
                }
            `}</style>
            <div className="w-full max-w-6xl">
                <header className="text-center mb-4">
                    <h1 className="text-4xl font-bold tracking-tighter text-cyan-300">Ed Rock's Pro Beat Machine</h1>
                    <p className="text-gray-400">Craft rhythms with the power of AI</p>
                </header>
                <main className="bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-2xl shadow-cyan-500/10 border border-gray-700">
                    <nav className="flex flex-wrap justify-center gap-1 sm:gap-2 p-2 border-b border-gray-700 bg-gray-900/50 rounded-t-lg">
                        <NavButton currentView={view} setView={setView} targetView="sequencer" icon={<IconMusicNote className="w-5 h-5"/>} label="Sequencer" />
                        <NavButton currentView={view} setView={setView} targetView="piano" icon={<IconKeyboard className="w-5 h-5"/>} label="Piano" />
                        <NavButton currentView={view} setView={setView} targetView="fx" icon={<IconRecord className="w-5 h-5"/>} label="FX / Record" />
                        <NavButton currentView={view} setView={setView} targetView="search" icon={<IconSearch className="w-5 h-5"/>} label="Search" />
                        <NavButton currentView={view} setView={setView} targetView="live" icon={<IconMic className="w-5 h-5"/>} label="Live Control" />
                    </nav>
                    <div className="p-4 md:p-6">
                        {renderView()}
                    </div>
                </main>
            </div>
        </div>
    );
}


// --- UI Components ---

interface SequencerGridProps {
    grid: GridState;
    currentStep: number | null;
    isPlaying: boolean;
    cycleStepPitch: (track: number, step: number) => void;
}

const pitchColorClasses = [
    '', // 0 is off
    'bg-cyan-900', // 1
    'bg-cyan-800',
    'bg-cyan-700',
    'bg-cyan-600',
    'bg-cyan-500', // 5 (middle)
    'bg-cyan-400',
    'bg-cyan-300',
    'bg-cyan-200',
    'bg-cyan-100', // 9
];

const SequencerGrid: React.FC<SequencerGridProps> = ({ grid, currentStep, isPlaying, cycleStepPitch }) => (
    <div className="flex-1 grid gap-1 p-2 bg-gray-900 rounded-lg shadow-inner overflow-x-auto">
        {grid.map((track, trackIndex) => (
            <div key={trackIndex} className="grid gap-1" style={{gridTemplateColumns: `repeat(${NUM_STEPS}, minmax(0, 1fr))`, minWidth: `${NUM_STEPS * 2.5}rem`}}>
                {track.map((pitchValue, stepIndex) => {
                    const isActive = pitchValue > 0;
                    const isCurrent = currentStep === stepIndex;
                    const isFourth = (stepIndex + 1) % 4 === 0;
                    
                    const buttonClass = `
                        w-full aspect-square rounded-md transition-all duration-100 ease-in-out transform flex items-center justify-center font-bold text-xs
                        ${isActive ? `${pitchColorClasses[pitchValue]} text-black` : isFourth ? 'bg-gray-700' : 'bg-gray-800'}
                        ${isCurrent && isPlaying ? 'ring-2 ring-white scale-105' : ''}
                        hover:ring-2 hover:ring-cyan-300
                    `;

                    return (
                        <button
                            key={stepIndex}
                            onClick={() => cycleStepPitch(trackIndex, stepIndex)}
                            className={buttonClass}
                        >
                            {isActive ? pitchValue : null}
                        </button>
                    );
                })}
            </div>
        ))}
    </div>
);

interface TrackControlsProps {
    clearTrack: (trackIndex: number) => void;
}
const TrackControls: React.FC<TrackControlsProps> = ({ clearTrack }) => (
    <div className="w-full md:w-64 flex flex-col gap-2 p-2 bg-gray-900 rounded-lg">
        {INSTRUMENTS.map((instrument, index) => (
            <div key={instrument} className="h-full flex items-center justify-between text-sm text-gray-300 gap-3 px-2 py-1 bg-gray-800/50 rounded">
                <span className="flex-1 truncate font-medium">{instrument}</span>
                <button onClick={() => clearTrack(index)} className="text-gray-500 hover:text-red-500 text-xs font-semibold">clear</button>
            </div>
        ))}
    </div>
);

interface PianoKeyboardProps {
    playPianoNote: (frequency: number) => void;
}
const PianoKeyboard: React.FC<PianoKeyboardProps> = ({ playPianoNote }) => {
    const [pressedKeys, setPressedKeys] = useState<Set<string>>(new Set());

    useEffect(() => {
        const keyMap = new Map(PIANO_NOTES.map(n => [n.key, n]));

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.repeat || pressedKeys.has(e.key)) return;
            const note = keyMap.get(e.key.toLowerCase());
            if (note) {
                playPianoNote(note.freq);
                setPressedKeys(prev => new Set(prev).add(e.key));
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
             setPressedKeys(prev => {
                const newSet = new Set(prev);
                newSet.delete(e.key);
                return newSet;
             });
        };

        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [playPianoNote, pressedKeys]);
    
    const whiteKeys = PIANO_NOTES.filter(n => n.type === 'white');
    const blackKeys = PIANO_NOTES.filter(n => n.type === 'black');

    return (
        <div className="relative w-full h-48" style={{ userSelect: 'none' }}>
            {/* White Keys */}
            <div className="absolute top-0 left-0 w-full h-full flex">
                {whiteKeys.map(note => (
                    <div key={note.note}
                         onMouseDown={() => playPianoNote(note.freq)}
                         className={`flex-1 h-full border-2 border-gray-900 rounded-b-md cursor-pointer transition-colors ${pressedKeys.has(note.key) ? 'bg-cyan-300' : 'bg-white'}`}>
                    </div>
                ))}
            </div>
             {/* Black Keys */}
            <div className="absolute top-0 left-0 w-full h-2/3 flex pointer-events-none">
                <div className="flex-1"></div>
                {blackKeys.map((note, index) => {
                    const isLastInGroup = note.note.includes('D#') || note.note.includes('A#');
                    return (
                       <div key={note.note} className="flex-1 flex justify-center" style={{marginLeft: '-3%', marginRight: '-3%'}}>
                         <div onMouseDown={(e) => { e.stopPropagation(); playPianoNote(note.freq); }}
                            className={`w-3/5 h-full bg-gray-800 border-2 border-gray-900 rounded-b-md cursor-pointer pointer-events-auto transition-colors ${pressedKeys.has(note.key) ? 'bg-cyan-500' : 'bg-gray-800'}`}
                            style={{marginRight: isLastInGroup ? '12.5%' : '0' }}>
                         </div>
                       </div>
                    );
                })}
                 <div className="flex-1"></div>
            </div>
        </div>
    );
};

interface NavButtonProps {
    targetView: View;
    icon: React.ReactNode;
    label: string;
    currentView: View;
    setView: (view: View) => void;
}
const NavButton: React.FC<NavButtonProps> = ({ targetView, icon, label, currentView, setView }) => (
    <button onClick={() => setView(targetView)} className={`flex flex-col sm:flex-row items-center gap-2 px-3 py-2 text-sm font-medium rounded-md transition-colors ${currentView === targetView ? 'bg-cyan-500 text-white' : 'text-gray-300 hover:bg-gray-700'}`}>
        {icon}
        <span className="hidden sm:inline">{label}</span>
    </button>
);


declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}