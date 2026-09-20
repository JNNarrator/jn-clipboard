import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { isTauriRuntime } from "../lib/tauriRuntime";
import {
  bindSoundAudioUnlock,
  closeSoundAudioContext,
  ensureSoundAudioRunning,
  scheduleSuspendSoundAudioContext
} from "../lib/soundAudio";

interface UseSoundEffectsOptions {
  soundEnabled: boolean;
  pasteSoundEnabled: boolean;
  soundVolume: number;
}

const playCrispBeep = (
  ctx: AudioContext,
  durationSec = 0.1,
  baseFreqHz = 1400,
  volume = 0.35
) => {
  if (ctx.state === "closed") return;

  const t0 = ctx.currentTime;
  const tEnd = t0 + Math.max(0.05, durationSec);

  const osc = ctx.createOscillator();
  osc.type = "triangle";

  osc.frequency.setValueAtTime(baseFreqHz * 1.25, t0);
  osc.frequency.exponentialRampToValueAtTime(
    Math.max(80, baseFreqHz * 0.92),
    t0 + Math.min(0.18, durationSec * 0.25)
  );

  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.setValueAtTime(Math.min(4000, baseFreqHz * 1.3), t0);
  filter.Q.setValueAtTime(6, t0);

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + 0.004);

  const mid = t0 + Math.min(0.08, durationSec * 0.2);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.35), mid);
  gain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

  const noiseDur = Math.min(0.03, durationSec * 0.1);
  const sampleRate = ctx.sampleRate || 44100;
  const bufferSize = Math.floor(sampleRate * noiseDur);

  let noiseBuf: AudioBuffer | undefined;
  try {
    noiseBuf = ctx.createBuffer(1, bufferSize > 0 ? bufferSize : 1, sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const decay = 1 - i / data.length;
      data[i] = (Math.random() * 2 - 1) * decay;
    }
  } catch (e) {
    console.error("Audio buffer error", e);
  }

  if (noiseBuf) {
    const noiseNode = ctx.createBufferSource();
    noiseNode.buffer = noiseBuf;

    const noiseHP = ctx.createBiquadFilter();
    noiseHP.type = "highpass";
    noiseHP.frequency.setValueAtTime(1500, t0);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(Math.max(0.0001, volume * 0.25), t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + noiseDur);

    noiseNode.connect(noiseHP);
    noiseHP.connect(noiseGain);
    noiseGain.connect(ctx.destination);

    noiseNode.start(t0);
    noiseNode.stop(t0 + noiseDur);
  }

  osc.connect(filter);
  filter.connect(gain);
  gain.connect(ctx.destination);

  osc.start(t0);
  osc.stop(tEnd + 0.01);
};

export const useSoundEffects = ({
  soundEnabled,
  pasteSoundEnabled,
  soundVolume
}: UseSoundEffectsOptions) => {
  const soundEnabledRef = useRef(soundEnabled);
  const pasteSoundEnabledRef = useRef(pasteSoundEnabled);
  const soundVolumeRef = useRef(soundVolume);

  soundEnabledRef.current = soundEnabled;
  pasteSoundEnabledRef.current = pasteSoundEnabled;
  soundVolumeRef.current = soundVolume;

  // Tear down Web Audio when sound is off so WKWebView stops holding a CoreAudio stream.
  useEffect(() => {
    if (!isTauriRuntime()) return;

    if (!soundEnabled) {
      void closeSoundAudioContext();
      return;
    }

    bindSoundAudioUnlock();
  }, [soundEnabled]);

  // Stable listener — volume / toggle changes update via refs, no AudioContext churn.
  useEffect(() => {
    if (!isTauriRuntime()) return;

    const unlisten = listen<string>("play-sound", (event) => {
      if (!soundEnabledRef.current) return;

      const type = event.payload;
      if (type === "paste" && !pasteSoundEnabledRef.current) return;

      const masterVol = Math.min(1, Math.max(0, soundVolumeRef.current));

      void ensureSoundAudioRunning().then((ctx) => {
        if (!ctx || !soundEnabledRef.current) return;

        try {
          if (type === "copy") {
            playCrispBeep(ctx, 0.06, 500, Math.min(1, masterVol * 0.8));
            scheduleSuspendSoundAudioContext(250);
          } else if (type === "paste") {
            playCrispBeep(ctx, 0.09, 950, Math.min(1, masterVol * 0.9));
            window.setTimeout(() => {
              if (ctx.state !== "closed" && soundEnabledRef.current) {
                playCrispBeep(ctx, 0.075, 1150, Math.min(1, masterVol * 0.75));
              }
              scheduleSuspendSoundAudioContext(300);
            }, 110);
          }
        } catch (e) {
          console.error("Sound play error", e);
          scheduleSuspendSoundAudioContext(100);
        }
      });
    });

    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    return () => {
      void closeSoundAudioContext();
    };
  }, []);
};
