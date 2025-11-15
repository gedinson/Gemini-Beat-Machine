



import React, { useState, useEffect, useRef, useCallback } from 'react';
// Fix: Import necessary types and classes from @google/genai for Live API implementation.
import { GoogleGenAI, LiveServerMessage, LiveSession, Modality, Type, FunctionDeclaration, Blob as GenAI_Blob } from '@google/genai';
import { Instrument, GridState, View, GroundingChunk, BeatPattern, Recording } from './types';
import { INSTRUMENTS, NUM_STEPS, NUM_TRACKS, IconSpark, IconMovie, IconImageEdit, IconSearch, IconMic, IconMusicNote, IconSoundWave, VEO_LOADING_MESSAGES, IconRecord, IconKeyboard, PIANO_NOTES } from './constants';
import * as geminiService from './services/geminiService';

// Helper: blob to base64
const blobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result as string;
            resolve(base64data.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

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


function createKick() {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.setValueAtTime(150, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    gain.gain.setValueAtTime(1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    osc.connect(gain);
    gain.connect(sequencerMasterGain);
    osc.start();
    osc.stop(audioContext.currentTime + 0.1);
}

function createSnare() {
    const noise = audioContext.createBufferSource();
    const bufferSize = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;
    const noiseFilter = audioContext.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    noise.connect(noiseFilter);
    const noiseEnvelope = audioContext.createGain();
    noiseFilter.connect(noiseEnvelope);
    noiseEnvelope.connect(sequencerMasterGain);
    noiseEnvelope.gain.setValueAtTime(1, audioContext.currentTime);
    noiseEnvelope.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    noise.start();
    noise.stop(audioContext.currentTime + 0.2);
}

function createHihat(isOpen: boolean) {
    const noise = audioContext.createBufferSource();
    const bufferSize = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;
    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 10000;
    bandpass.Q.value = 1.5;
    noise.connect(bandpass);
    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 7000;
    bandpass.connect(highpass);
    const gain = audioContext.createGain();
    highpass.connect(gain);
    gain.connect(sequencerMasterGain);
    gain.gain.setValueAtTime(1, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + (isOpen ? 0.5 : 0.05));
    noise.start();
    noise.stop(audioContext.currentTime + (isOpen ? 0.5 : 0.05));
}

function createClap() {
    const noise = audioContext.createBufferSource();
    const bufferSize = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) { output[i] = Math.random() * 2 - 1; }
    noise.buffer = buffer;

    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 2500;
    bandpass.Q.value = 1.0;
    noise.connect(bandpass);
    
    const envelope = audioContext.createGain();
    bandpass.connect(envelope);
    envelope.connect(sequencerMasterGain);

    const now = audioContext.currentTime;
    envelope.gain.setValueAtTime(0, now);
    envelope.gain.linearRampToValueAtTime(0.8, now + 0.005);
    envelope.gain.linearRampToValueAtTime(0, now + 0.01);
    envelope.gain.linearRampToValueAtTime(0.8, now + 0.015);
    envelope.gain.linearRampToValueAtTime(0, now + 0.02);
    envelope.gain.linearRampToValueAtTime(0.6, now + 0.025);
    envelope.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    
    noise.start(now);
    noise.stop(now + 0.2);
}

function createTom() {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.frequency.setValueAtTime(300, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(100, audioContext.currentTime + 0.2);
    gain.gain.setValueAtTime(0.8, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(sequencerMasterGain);
    osc.start();
    osc.stop(audioContext.currentTime + 0.2);
}

function createRimshot() {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioContext.currentTime);
    osc.frequency.exponentialRampToValueAtTime(400, audioContext.currentTime + 0.05);
    gain.gain.setValueAtTime(0.5, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.05);
    osc.connect(gain);
    gain.connect(sequencerMasterGain);
    osc.start();
    osc.stop(audioContext.currentTime + 0.05);
}

function createCowbell() {
    const osc1 = audioContext.createOscillator();
    const osc2 = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc1.type = 'square';
    osc2.type = 'square';
    osc1.frequency.value = 540;
    osc2.frequency.value = 810;
    gain.gain.setValueAtTime(0.3, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.15);
    osc1.connect(gain);
    osc2.connect(gain);
    gain.connect(sequencerMasterGain);
    osc1.start();
    osc2.start();
    osc1.stop(audioContext.currentTime + 0.15);
    osc2.stop(audioContext.currentTime + 0.15);
}

function createCymbal() {
    const noise = audioContext.createBufferSource();
    const bufferSize = audioContext.sampleRate * 2;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;

    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 12000;
    bandpass.Q.value = 0.5;
    noise.connect(bandpass);

    const highpass = audioContext.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 5000;
    bandpass.connect(highpass);

    const gain = audioContext.createGain();
    highpass.connect(gain);
    gain.connect(sequencerMasterGain);

    gain.gain.setValueAtTime(0.5, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 1.5);
    noise.start();
    noise.stop(audioContext.currentTime + 1.5);
}

function createShaker() {
    const noise = audioContext.createBufferSource();
    const bufferSize = audioContext.sampleRate;
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
    }
    noise.buffer = buffer;
    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 8000;
    bandpass.Q.value = 2;
    noise.connect(bandpass);

    const gain = audioContext.createGain();
    bandpass.connect(gain);
    gain.connect(sequencerMasterGain);
    gain.gain.setValueAtTime(0.4, audioContext.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
    noise.start();
    noise.stop(audioContext.currentTime + 0.1);
}

const soundPlayer: Record<Instrument, () => void> = {
    'Kick': createKick,
    'Snare': createSnare,
    'Hi-hat (Closed)': () => createHihat(false),
    'Hi-hat (Open)': () => createHihat(true),
    'Clap': createClap,
    'Tom': createTom,
    'Rimshot': createRimshot,
    'Cowbell': createCowbell,
    'Cymbal': createCymbal,
    'Shaker': createShaker,
};


// --- UI Components ---

interface SequencerGridProps {
    grid: GridState;
    currentStep: number | null;
    isPlaying: boolean;
    toggleStep: (track: number, step: number) => void;
}
const SequencerGrid: React.FC<SequencerGridProps> = ({ grid, currentStep, isPlaying, toggleStep }) => (
    <div className="flex-1 grid gap-1 p-2 bg-gray-900 rounded-lg shadow-inner overflow-x-auto">
        {grid.map((track, trackIndex) => (
            <div key={trackIndex} className="grid gap-1" style={{gridTemplateColumns: `repeat(${NUM_STEPS}, minmax(0, 1fr))`, minWidth: `${NUM_STEPS * 2}rem`}}>
                {track.map((step, stepIndex) => {
                    const isActive = step;
                    const isCurrent = currentStep === stepIndex;
                    const isFourth = (stepIndex + 1) % 4 === 0;

                    return (
                        <button
                            key={stepIndex}
                            onClick={() => toggleStep(trackIndex, stepIndex)}
                            className={`w-full aspect-square rounded-md transition-all duration-100 ease-in-out transform
                ${isActive ? 'bg-cyan-400 shadow-cyan-400/50 shadow-lg scale-105' : isFourth ? 'bg-gray-700' : 'bg-gray-800'}
                ${isCurrent && isPlaying ? 'ring-2 ring-white' : ''}
                hover:bg-cyan-300`}
                        />
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
    <div className="grid gap-1 p-2 pr-4 bg-gray-900">
        {INSTRUMENTS.map((instrument, index) => (
            <div key={instrument} className="h-full flex items-center justify-between text-sm text-gray-300">
                <span className="w-32 truncate">{instrument}</span>
                <button onClick={() => clearTrack(index)} className="text-gray-500 hover:text-red-500 text-xs">clear</button>
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


// --- Main Application ---

export default function App() {
    const [view, setView] = useState<View>('sequencer');
    const [grid, setGrid] = useState<GridState>(() => Array.from({ length: NUM_TRACKS }, () => Array(NUM_STEPS).fill(false)));
    const [isPlaying, setIsPlaying] = useState(false);
    const [tempo, setTempo] = useState(120);
    const [currentStep, setCurrentStep] = useState<number | null>(null);
    const timerRef = useRef<number | null>(null);

    // AI Feature States
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResult, setSearchResult] = useState<{ text: string; groundingChunks: GroundingChunk[] } | null>(null);
    const [ttsText, setTtsText] = useState('');
    const [generatedAudio, setGeneratedAudio] = useState<string | null>(null);
    const [uploadedImage, setUploadedImage] = useState<{ file: File, url: string, base64: string } | null>(null);
    const [imageEditPrompt, setImageEditPrompt] = useState('');
    const [editedImage, setEditedImage] = useState<string | null>(null);
    const [veoPrompt, setVeoPrompt] = useState('');
    const [generatedVideo, setGeneratedVideo] = useState<string | null>(null);
    const [veoAspectRatio, setVeoAspectRatio] = useState<'16:9' | '9:16'>('16:9');
    const [hasSelectedApiKey, setHasSelectedApiKey] = useState(false);
    const [veoLoadingMessage, setVeoLoadingMessage] = useState("");

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
    const audioFxNodes = useRef<any>({});
    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const mediaStreamDestination = useRef<MediaStreamAudioDestinationNode | null>(null);
    const pianoMasterGain = useRef<GainNode | null>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationFrameRef = useRef<number>();

    // Setup piano master gain node
    useEffect(() => {
        const pmg = audioContext.createGain();
        pmg.connect(audioContext.destination);
        pianoMasterGain.current = pmg;
    }, []);


    const toggleStep = useCallback((track: number, step: number) => {
        setGrid(prevGrid => {
            const newGrid = prevGrid.map(t => [...t]);
            newGrid[track][step] = !newGrid[track][step];
            return newGrid;
        });
    }, []);

    const clearTrack = (trackIndex: number) => {
        setGrid(prevGrid => {
            const newGrid = prevGrid.map(t => [...t]);
            newGrid[trackIndex] = Array(NUM_STEPS).fill(false);
            return newGrid;
        });
    }
    
    const clearAll = useCallback(() => {
        setGrid(Array.from({ length: NUM_TRACKS }, () => Array(NUM_STEPS).fill(false)));
    }, []);

    const setSteps = useCallback((trackName: string, steps: number[]) => {
        const trackIndex = INSTRUMENTS.findIndex(inst => inst.toLowerCase().includes(trackName.toLowerCase()));
        if (trackIndex === -1) return;
        
        setGrid(prevGrid => {
            const newGrid = prevGrid.map(t => [...t]);
            const newTrack = Array(NUM_STEPS).fill(false);
            steps.forEach(step => {
                if(step >= 1 && step <= NUM_STEPS) {
                    newTrack[step-1] = true;
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

    useEffect(() => {
        if (isPlaying) {
            const interval = 60000 / tempo / 4; // 16th notes
            timerRef.current = window.setInterval(() => {
                setCurrentStep(prev => {
                    const nextStep = (prev === null ? 0 : prev + 1) % NUM_STEPS;
                    grid.forEach((track, trackIndex) => {
                        if (track[nextStep]) {
                            soundPlayer[INSTRUMENTS[trackIndex]]();
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
    }, [isPlaying, tempo, grid]);

    // --- Gemini Feature Handlers ---

    const handleGenerateBeat = async () => {
        if (!aiPrompt) return;
        setIsGenerating(true);
        try {
            const pattern = await geminiService.generateBeatPattern(aiPrompt);
            if (pattern) {
                const newGrid = INSTRUMENTS.map(instrument => {
                    const trackPattern = pattern[instrument as Instrument];
                    return trackPattern ? trackPattern.map(step => step === 1) : Array(NUM_STEPS).fill(false);
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

    const handleGenerateSpeech = async () => {
        if (!ttsText) return;
        setIsGenerating(true);
        setGeneratedAudio(null);
        try {
            const audioB64 = await geminiService.generateSpeech(ttsText);
            if (audioB64) {
                setGeneratedAudio(`data:audio/wav;base64,${audioB64}`);
            }
        } finally {
            setIsGenerating(false);
        }
    };
    
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            blobToBase64(file).then(base64 => {
                setUploadedImage({ file, url, base64 });
                setEditedImage(null);
                setGeneratedVideo(null);
            });
        }
    };

    const handleEditImage = async () => {
        if (!uploadedImage || !imageEditPrompt) return;
        setIsGenerating(true);
        setEditedImage(null);
        try {
            const result = await geminiService.editImage(imageEditPrompt, uploadedImage.base64, uploadedImage.file.type);
            if (result) {
                setEditedImage(`data:${uploadedImage.file.type};base64,${result}`);
            }
        } finally {
            setIsGenerating(false);
        }
    };
    
    const checkApiKey = async () => {
        if (window.aistudio && await window.aistudio.hasSelectedApiKey()) {
            setHasSelectedApiKey(true);
        } else {
            setHasSelectedApiKey(false);
        }
    };

    useEffect(() => {
        checkApiKey();
    }, []);
    
    const handleAnimate = async () => {
        if (!uploadedImage || !veoPrompt) return;
        
        if (!hasSelectedApiKey) {
            await window.aistudio.openSelectKey();
            // Assume key selection is successful to proceed.
            setHasSelectedApiKey(true);
        }

        setIsGenerating(true);
        setGeneratedVideo(null);
        let messageInterval: number | undefined;

        try {
            let messageIndex = 0;
            setVeoLoadingMessage(VEO_LOADING_MESSAGES[messageIndex]);
            messageInterval = window.setInterval(() => {
                messageIndex = (messageIndex + 1) % VEO_LOADING_MESSAGES.length;
                setVeoLoadingMessage(VEO_LOADING_MESSAGES[messageIndex]);
            }, 5000);
            
            const resultUrl = await geminiService.animateImage(veoPrompt, uploadedImage.base64, uploadedImage.file.type, veoAspectRatio);
            setGeneratedVideo(resultUrl);
        } catch (error: any) {
            console.error("Error animating image:", error);
            if (error.message?.includes("Requested entity was not found")) {
                setHasSelectedApiKey(false);
                alert("API Key not found or invalid. Please select your API key again.");
            } else {
                 alert(`An error occurred: ${error.message}`);
            }
        } finally {
            setIsGenerating(false);
            if(messageInterval) clearInterval(messageInterval);
            setVeoLoadingMessage("");
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
        if (!pianoMasterGain.current) return;
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(frequency, audioContext.currentTime);
        
        gain.gain.setValueAtTime(0, audioContext.currentTime);
        gain.gain.linearRampToValueAtTime(0.3, audioContext.currentTime + 0.01); // Quick attack
        gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.5); // Decay

        osc.connect(gain);
        gain.connect(pianoMasterGain.current);

        osc.start(audioContext.currentTime);
        osc.stop(audioContext.currentTime + 0.5);
    }, []);

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
        if (pianoMasterGain.current) {
            pianoMasterGain.current.connect(dest);
        }
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
                if (pianoMasterGain.current) {
                    pianoMasterGain.current.disconnect(destNode);
                }
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
    
    // --- Components ---

    const renderView = () => {
        const commonInputClass = "w-full p-3 bg-gray-700 border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-cyan-400 focus:outline-none transition";
        const commonButtonClass = "w-full p-3 bg-cyan-500 text-white font-bold rounded-lg hover:bg-cyan-600 transition disabled:bg-gray-500 disabled:cursor-not-allowed flex items-center justify-center gap-2";

        switch (view) {
             case 'piano':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold text-cyan-300 text-center">Virtual Piano</h2>
                        <p className="text-gray-400 text-center">Click or use your keyboard to play (Keys: A, W, S, E, D...)</p>
                        <div className="p-4 bg-gray-900 rounded-lg">
                           <PianoKeyboard playPianoNote={playPianoNote} />
                        </div>
                    </div>
                );
            case 'fx':
                return (
                    <div className="space-y-6">
                         <h2 className="text-2xl font-bold text-cyan-300">FX & Recording Studio</h2>
                         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
            case 'veo':
                return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold text-cyan-300">Veo Video Animator</h2>
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-50 file:text-cyan-700 hover:file:bg-cyan-100"/>
                        {uploadedImage && <img src={uploadedImage.url} alt="Uploaded" className="max-w-xs mx-auto rounded-lg" />}
                        <textarea value={veoPrompt} onChange={(e) => setVeoPrompt(e.target.value)} placeholder="Animation prompt, e.g., 'A subtle zoom in, with sparkling lights'" className={commonInputClass} rows={3}></textarea>
                        <div className="flex gap-2 items-center text-white">
                            <span>Aspect Ratio:</span>
                            <button onClick={() => setVeoAspectRatio('16:9')} className={`px-3 py-1 rounded ${veoAspectRatio === '16:9' ? 'bg-cyan-500' : 'bg-gray-600'}`}>16:9</button>
                            <button onClick={() => setVeoAspectRatio('9:16')} className={`px-3 py-1 rounded ${veoAspectRatio === '9:16' ? 'bg-cyan-500' : 'bg-gray-600'}`}>9:16</button>
                        </div>
                        <button onClick={handleAnimate} disabled={isGenerating || !uploadedImage || !veoPrompt} className={commonButtonClass}>
                            {isGenerating ? 'Animating...' : 'Animate with Veo'}
                        </button>
                         {!hasSelectedApiKey && <button onClick={() => window.aistudio.openSelectKey()} className="text-cyan-400 underline mt-2">Select API Key</button>}
                        {isGenerating && <p className="text-center text-cyan-300 animate-pulse">{veoLoadingMessage}</p>}
                        {generatedVideo && <video src={generatedVideo} controls autoPlay loop className="w-full rounded-lg mt-4"></video>}
                    </div>
                );
            case 'imageEditor':
                 return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold text-cyan-300">Nano Banana Image Editor</h2>
                        <input type="file" accept="image/*" onChange={handleImageUpload} className="block w-full text-sm text-gray-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-cyan-50 file:text-cyan-700 hover:file:bg-cyan-100"/>
                        <textarea value={imageEditPrompt} onChange={(e) => setImageEditPrompt(e.target.value)} placeholder="Edit prompt, e.g., 'Add a retro film grain effect'" className={commonInputClass} rows={2}></textarea>
                        <button onClick={handleEditImage} disabled={isGenerating || !uploadedImage || !imageEditPrompt} className={commonButtonClass}>
                            {isGenerating ? 'Editing...' : 'Edit Image'}
                        </button>
                        <div className="flex gap-4 justify-center">
                            {uploadedImage && <div><h3 className="text-center text-gray-400 mb-2">Original</h3><img src={uploadedImage.url} alt="Uploaded" className="max-w-xs rounded-lg" /></div>}
                            {editedImage && <div><h3 className="text-center text-gray-400 mb-2">Edited</h3><img src={editedImage} alt="Edited" className="max-w-xs rounded-lg" /></div>}
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
            case 'tts':
                 return (
                    <div className="space-y-4">
                        <h2 className="text-2xl font-bold text-cyan-300">TTS Vocal Sampler</h2>
                        <textarea value={ttsText} onChange={e => setTtsText(e.target.value)} placeholder="Enter text to generate a vocal sample..." className={commonInputClass} rows={3}/>
                        <button onClick={handleGenerateSpeech} disabled={isGenerating || !ttsText} className={commonButtonClass}>
                            {isGenerating ? 'Generating...' : 'Generate Vocal'}
                        </button>
                        {generatedAudio && <audio src={generatedAudio} controls className="w-full mt-4"></audio>}
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
                    <>
                        <div className="flex flex-col md:flex-row gap-4">
                            <TrackControls clearTrack={clearTrack} />
                            <SequencerGrid grid={grid} currentStep={currentStep} isPlaying={isPlaying} toggleStep={toggleStep} />
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
                    </>
                );
        }
    };

    return (
        <div className="min-h-screen text-white p-2 sm:p-4 lg:p-8 flex flex-col items-center">
            <div className="w-full max-w-6xl">
                <header className="text-center mb-4">
                    <h1 className="text-4xl font-bold tracking-tighter text-cyan-300">Gemini Beat Machine Pro</h1>
                    <p className="text-gray-400">Craft rhythms with the power of AI</p>
                </header>
                <main className="bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-2xl shadow-cyan-500/10 border border-gray-700">
                    <nav className="flex flex-wrap justify-center gap-1 sm:gap-2 p-2 border-b border-gray-700 bg-gray-900/50 rounded-t-lg">
                        <NavButton currentView={view} setView={setView} targetView="sequencer" icon={<IconMusicNote className="w-5 h-5"/>} label="Sequencer" />
                        <NavButton currentView={view} setView={setView} targetView="piano" icon={<IconKeyboard className="w-5 h-5"/>} label="Piano" />
                        <NavButton currentView={view} setView={setView} targetView="fx" icon={<IconRecord className="w-5 h-5"/>} label="FX / Record" />
                        <NavButton currentView={view} setView={setView} targetView="tts" icon={<IconSoundWave className="w-5 h-5"/>} label="TTS Sampler" />
                        <NavButton currentView={view} setView={setView} targetView="veo" icon={<IconMovie className="w-5 h-5"/>} label="Veo Animator" />
                        <NavButton currentView={view} setView={setView} targetView="imageEditor" icon={<IconImageEdit className="w-5 h-5"/>} label="Image Editor" />
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

declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}
