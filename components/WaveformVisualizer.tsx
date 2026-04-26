import React, { useEffect, useRef } from 'react';

interface WaveformVisualizerProps {
  buffer: AudioBuffer | null | undefined;
  peaks?: number[];
  isPlaying: boolean;
  audioContext: AudioContext | null;
  analyser: AnalyserNode | null;
  color?: string;
}

const WaveformVisualizer: React.FC<WaveformVisualizerProps> = ({ 
  buffer, 
  peaks,
  isPlaying, 
  analyser, 
  color = "#38bdf8" 
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number>();

  // Static waveform render (when not playing or paused)
  useEffect(() => {
    if (!canvasRef.current || isPlaying) return;
    if (!buffer && !peaks) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    const amp = height / 2;

    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.moveTo(0, amp);

    if (peaks) {
       // Peaks has max,min for each sample step
       const numSteps = peaks.length / 2;
       const stepWidth = width / numSteps;
       
       for (let i = 0; i < numSteps; i++) {
         const max = peaks[i * 2];
         const min = peaks[i * 2 + 1];
         const x = i * stepWidth;
         ctx.lineTo(x, (1 + min) * amp);
         ctx.lineTo(x, (1 + max) * amp);
       }
    } else if (buffer) {
       const data = buffer.getChannelData(0);
       const step = Math.ceil(data.length / width);
       for (let i = 0; i < width; i++) {
         let min = 1.0;
         let max = -1.0;
         for (let j = 0; j < step; j++) {
           let datum = data[i * step + j];
           if (datum === undefined) datum = 0;
           if (datum < min) min = datum;
           if (datum > max) max = datum;
         }
         ctx.lineTo(i, (1 + min) * amp);
         ctx.lineTo(i, (1 + max) * amp);
       }
    }
    
    ctx.stroke();

  }, [buffer, peaks, isPlaying, color]);

  // Live analyzer render (when playing)
  useEffect(() => {
    if (!isPlaying || !analyser || !canvasRef.current) {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
      return;
    }

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationRef.current = requestAnimationFrame(draw);

      analyser.getByteTimeDomainData(dataArray);

      ctx.fillStyle = 'rgb(15, 23, 42)'; // Slate 900 background to clear
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = 2;
      ctx.strokeStyle = color;

      ctx.beginPath();

      const sliceWidth = (canvas.width * 1.0) / bufferLength;
      let x = 0;

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * canvas.height) / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    };

    draw();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isPlaying, analyser, color]);

  return (
    <canvas 
      ref={canvasRef} 
      width={600} 
      height={100} 
      className="w-full h-full rounded-md bg-slate-900/50"
    />
  );
};

export default WaveformVisualizer;
