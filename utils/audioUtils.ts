import { AudioQuality } from '../types';

// Decodes base64 raw PCM string to AudioBuffer
// Assuming Gemini returns 24kHz mono raw PCM (Int16) usually, but we verify via config
export const decodeBase64Audio = async (
  base64String: string,
  audioContext: AudioContext,
  sampleRate = 24000
): Promise<AudioBuffer> => {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  // Convert Int16 PCM to Float32 for AudioBuffer
  const dataInt16 = new Int16Array(bytes.buffer);
  const buffer = audioContext.createBuffer(1, dataInt16.length, sampleRate);
  const channelData = buffer.getChannelData(0);
  
  for (let i = 0; i < dataInt16.length; i++) {
    channelData[i] = dataInt16[i] / 32768.0;
  }

  return buffer;
};

// Resample AudioBuffer if needed
const resampleAudioBuffer = async (
  buffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> => {
  if (buffer.sampleRate === targetSampleRate) return buffer;

  const offlineCtx = new OfflineAudioContext(
    buffer.numberOfChannels,
    (buffer.length * targetSampleRate) / buffer.sampleRate,
    targetSampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  
  return await offlineCtx.startRendering();
};

export const extractPeaks = (buffer: AudioBuffer, samples: number = 200): number[] => {
  const data = buffer.getChannelData(0);
  const step = Math.ceil(data.length / samples);
  const peaks = [];
  for (let i = 0; i < samples; i++) {
    let min = 1.0;
    let max = -1.0;
    for (let j = 0; j < step; j++) {
      const datum = data[i * step + j];
      if (datum < min) min = datum;
      if (datum > max) max = datum;
    }
    peaks.push(max, min);
  }
  return peaks;
};

// Convert AudioBuffer to WAV Blob
export const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  let result;
  if (numChannels === 2) {
      result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
      result = buffer.getChannelData(0);
  }

  return encodeWAV(result, format, sampleRate, numChannels, bitDepth);
};

function interleave(inputL: Float32Array, inputR: Float32Array) {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function encodeWAV(samples: Float32Array, format: number, sampleRate: number, numChannels: number, bitDepth: number) {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * bytesPerSample, true);

  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

function floatTo16BitPCM(output: DataView, offset: number, input: Float32Array) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
}

// Convert AudioBuffer to MP3 Blob using lamejs
export const audioBufferToMp3 = (buffer: AudioBuffer, kbps: number): Blob => {
  const win = window as any;
  if (!win.lamejs) {
    console.error("LameJS not found");
    throw new Error("MP3 encoder not loaded");
  }

  const channels = 1; // Mono for TTS usually
  const sampleRate = buffer.sampleRate;
  const mp3encoder = new win.lamejs.Mp3Encoder(channels, sampleRate, kbps);
  
  const samples = buffer.getChannelData(0);
  
  // LameJS expects Int16
  const sampleData = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      sampleData[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  
  const mp3Data = [];
  const blockSize = 1152;
  for (let i = 0; i < sampleData.length; i += blockSize) {
      const sampleChunk = sampleData.subarray(i, i + blockSize);
      const mp3buf = mp3encoder.encodeBuffer(sampleChunk);
      if (mp3buf.length > 0) {
          mp3Data.push(mp3buf);
      }
  }
  
  const mp3buf = mp3encoder.flush();
  if (mp3buf.length > 0) {
      mp3Data.push(mp3buf);
  }

  return new Blob(mp3Data, { type: 'audio/mp3' });
};

// Master export function
export const exportAudio = async (
  buffer: AudioBuffer,
  quality: AudioQuality
): Promise<{ blob: Blob; filename: string }> => {
  let targetBuffer = buffer;
  let blob: Blob;
  let ext = 'wav';

  switch (quality) {
    case AudioQuality.HIGH_WAV:
      // Keep original sample rate (likely 24kHz)
      blob = audioBufferToWav(targetBuffer);
      ext = 'wav';
      break;
    case AudioQuality.LOW_WAV:
      // Resample to 8kHz
      targetBuffer = await resampleAudioBuffer(buffer, 8000);
      blob = audioBufferToWav(targetBuffer);
      ext = 'wav';
      break;
    case AudioQuality.HIGH_MP3:
      blob = audioBufferToMp3(targetBuffer, 128);
      ext = 'mp3';
      break;
    case AudioQuality.LOW_MP3:
      blob = audioBufferToMp3(targetBuffer, 64);
      ext = 'mp3';
      break;
    default:
      blob = audioBufferToWav(targetBuffer);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return { blob, filename: `voxgemini_${timestamp}.${ext}` };
};

// Concatenate multiple AudioBuffers sequentially
export const concatAudioBuffers = (buffers: AudioBuffer[], ctx: AudioContext): AudioBuffer => {
  if (buffers.length === 0) throw new Error("No buffers to concatenate");
  if (buffers.length === 1) return buffers[0];

  const format = buffers[0];
  const totalLength = buffers.reduce((acc, buf) => acc + buf.length, 0);

  const result = ctx.createBuffer(
    format.numberOfChannels,
    totalLength,
    format.sampleRate
  );

  for (let channel = 0; channel < format.numberOfChannels; channel++) {
    const channelData = result.getChannelData(channel);
    let offset = 0;
    for (const buffer of buffers) {
      // Handle cases where some buffers have fewer channels
      const sourceData = buffer.numberOfChannels > channel
        ? buffer.getChannelData(channel)
        : buffer.getChannelData(0);
      channelData.set(sourceData, offset);
      offset += buffer.length;
    }
  }

  return result;
};

// Mix two AudioBuffers (e.g. voice and background music)
export const mixAudioBuffers = (
  voiceBuffer: AudioBuffer,
  bgBuffer: AudioBuffer,
  ctx: AudioContext,
  bgVolume: number = 0.3
): AudioBuffer => {
  const numberOfChannels = Math.max(voiceBuffer.numberOfChannels, bgBuffer.numberOfChannels);
  // Match length to the voice buffer. We will loop BGM if it's shorter.
  const resultLength = voiceBuffer.length;

  const result = ctx.createBuffer(
    numberOfChannels,
    resultLength,
    voiceBuffer.sampleRate
  );

  // If sample rates don't match exactly, this simple looping might be slightly distorted or pitch-shifted 
  // if not resampled, but standard AudioBuffer usually shares the context sampleRate anyway.

  for (let channel = 0; channel < numberOfChannels; channel++) {
    const resultData = result.getChannelData(channel);
    
    const voiceData = channel < voiceBuffer.numberOfChannels 
      ? voiceBuffer.getChannelData(channel) 
      : voiceBuffer.getChannelData(0);
      
    const bgData = channel < bgBuffer.numberOfChannels 
      ? bgBuffer.getChannelData(channel) 
      : bgBuffer.getChannelData(0);

    for (let i = 0; i < resultLength; i++) {
        // Handle looping if bgBuffer is shorter
        const bgIndex = i % bgBuffer.length;
        
        resultData[i] = voiceData[i] + (bgData[bgIndex] * bgVolume);
        
        // Simple clipping
        if (resultData[i] > 1.0) resultData[i] = 1.0;
        if (resultData[i] < -1.0) resultData[i] = -1.0;
    }
  }

  return result;
};