export type VoiceName = 'Kore' | 'Puck' | 'Charon' | 'Fenrir' | 'Zephyr';

export enum AudioQuality {
  HIGH_WAV = 'HIGH_WAV', // 24kHz/44.1kHz (Native/Upsampled) 32-bit float or 16-bit PCM
  LOW_WAV = 'LOW_WAV',   // 8kHz Downsampled
  HIGH_MP3 = 'HIGH_MP3', // 128kbps
  LOW_MP3 = 'LOW_MP3',   // 64kbps
}

export interface GeneratedAudio {
  id: string;
  text: string;
  style: string;
  voice: VoiceName | 'Mixed';
  timestamp: number;
  buffer?: AudioBuffer; // Keep raw buffer for playback/processing, optional for memory saving
  peaks?: number[]; // Audio peaks for visualization when buffer is dropped
  blobUrl?: string; // For immediate playback if needed, though we use AudioContext mostly
}

export interface ScriptLine {
  id: string;
  voice: VoiceName;
  style: string;
  text: string;
}

export interface GenerationParams {
  text: string;
  style: string;
  voice: VoiceName;
}

// LameJS global declaration
declare global {
  const lamejs: any;
}