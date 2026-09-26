export interface StudioAudioPipeline {
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  highPass: BiquadFilterNode;
  lowPass: BiquadFilterNode;
  compressor: DynamicsCompressorNode;
  analyser: AnalyserNode;
  getLevel: () => number;
  gate: GainNode;
  destination: MediaStreamAudioDestinationNode;
  stream: MediaStream;
  stop: () => Promise<void>;
}

function createFilter(context: AudioContext, type: BiquadFilterType, frequency: number, q = 0.707) {
  const node = context.createBiquadFilter();
  node.type = type;
  node.frequency.value = frequency;
  node.Q.value = q;
  return node;
}

/**
 * Browser-side voice mastering chain.
 * WebRTC constraints perform the heavy adaptive noise/echo work; this stage
 * removes rumble, limits harsh highs, compresses speech dynamics, and gently
 * gates only true near-silence instead of chopping normal speech.
 */
export async function createStudioAudioPipeline(input: MediaStream): Promise<StudioAudioPipeline> {
  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
  if (!AudioContextCtor) throw new Error('This browser does not support studio audio processing.');

  const context: AudioContext = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: 48000 });
  if (context.state === 'suspended') await context.resume();

  const source = context.createMediaStreamSource(input);
  const highPass = createFilter(context, 'highpass', 70, 0.75);
  const lowPass = createFilter(context, 'lowpass', 16500, 0.55);

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -20;
  compressor.knee.value = 18;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.12;

  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.82;

  const gate = context.createGain();
  gate.gain.value = 1;

  const destination = context.createMediaStreamDestination();
  source.connect(highPass);
  highPass.connect(lowPass);
  lowPass.connect(compressor);
  compressor.connect(analyser);
  analyser.connect(gate);
  gate.connect(destination);

  const data = new Float32Array(analyser.fftSize);
  let raf = 0;
  let lastActive = performance.now();
  let gateClosed = false;

  const tick = () => {
    analyser.getFloatTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
    const rms = Math.sqrt(sum / data.length);
    const db = 20 * Math.log10(Math.max(rms, 0.00001));
    const now = performance.now();

    // Browser NS handles broadband noise. The gate only attenuates sustained
    // near-silence, with a hold time so word endings are not chopped.
    if (db > -48) lastActive = now;
    const shouldClose = now - lastActive > 450 && db < -52;
    if (shouldClose !== gateClosed) {
      gateClosed = shouldClose;
      gate.gain.cancelScheduledValues(context.currentTime);
      gate.gain.setTargetAtTime(shouldClose ? 0.08 : 1, context.currentTime, shouldClose ? 0.08 : 0.025);
    }
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    context, source, highPass, lowPass, compressor, analyser, gate, destination,
    stream: destination.stream,
    getLevel: () => {
      const values = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(values);
      let sum = 0;
      for (let i = 0; i < values.length; i++) sum += values[i] * values[i];
      const rms = Math.sqrt(sum / values.length);
      const db = 20 * Math.log10(Math.max(rms, 0.00001));
      return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
    },
    stop: async () => {
      cancelAnimationFrame(raf);
      try { source.disconnect(); highPass.disconnect(); lowPass.disconnect(); compressor.disconnect(); analyser.disconnect(); gate.disconnect(); destination.disconnect(); } catch {}
      if (context.state !== 'closed') await context.close();
    },
  };
}

export async function requestStudioMicrophone(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 24 },
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
    video: false,
  });
}

export function chooseAudioMimeType(): string {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) ?? '';
}
