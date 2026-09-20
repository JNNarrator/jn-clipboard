type AudioContextCtor = typeof AudioContext;

let sharedCtx: AudioContext | null = null;
let unlockBound = false;
let suspendTimer: ReturnType<typeof setTimeout> | null = null;

const getAudioContextCtor = (): AudioContextCtor | null => {
  if (typeof window === "undefined") return null;
  return (
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext ||
    null
  );
};

const clearSuspendTimer = () => {
  if (suspendTimer == null) return;
  clearTimeout(suspendTimer);
  suspendTimer = null;
};

/** Lazily create a shared AudioContext. Does not resume it. */
export const getOrCreateSoundAudioContext = (): AudioContext | null => {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;

  if (!sharedCtx || sharedCtx.state === "closed") {
    sharedCtx = new Ctor();
  }
  return sharedCtx;
};

/** Resume an existing context only — never create one from a gesture unlock. */
export const unlockSoundAudioContext = async (): Promise<void> => {
  const ctx = sharedCtx;
  if (!ctx || ctx.state === "closed" || ctx.state === "running") return;

  try {
    await ctx.resume();
  } catch {
    // ignore — will retry on next gesture / play
  }
};

/**
 * Ensure a running AudioContext for playback. Creates lazily on first need.
 * Returns the context when ready, or null if Web Audio is unavailable.
 */
export const ensureSoundAudioRunning = async (): Promise<AudioContext | null> => {
  clearSuspendTimer();

  const ctx = getOrCreateSoundAudioContext();
  if (!ctx || ctx.state === "closed") return null;

  if (ctx.state === "suspended") {
    try {
      await ctx.resume();
    } catch {
      return null;
    }
  }

  return ctx.state === "running" ? ctx : null;
};

/** Release the CoreAudio output stream so other apps keep bluetooth routing. */
export const suspendSoundAudioContext = async (): Promise<void> => {
  clearSuspendTimer();
  const ctx = sharedCtx;
  if (!ctx || ctx.state !== "running") return;

  try {
    await ctx.suspend();
  } catch {
    // ignore
  }
};

/** Defer suspend so multi-beep sequences (paste) can finish first. */
export const scheduleSuspendSoundAudioContext = (delayMs = 500): void => {
  clearSuspendTimer();
  suspendTimer = setTimeout(() => {
    suspendTimer = null;
    void suspendSoundAudioContext();
  }, delayMs);
};

/** Fully tear down Web Audio (sound disabled / unmount). */
export const closeSoundAudioContext = async (): Promise<void> => {
  clearSuspendTimer();
  const ctx = sharedCtx;
  sharedCtx = null;
  if (!ctx || ctx.state === "closed") return;

  try {
    await ctx.close();
  } catch {
    // ignore
  }
};

/**
 * Bind gesture unlockers that only resume an *existing* context.
 * Does not create AudioContext — creation stays lazy until first play.
 */
export const bindSoundAudioUnlock = (): void => {
  if (unlockBound || typeof document === "undefined") return;
  unlockBound = true;

  const onGesture = () => {
    void unlockSoundAudioContext();
  };

  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("keydown", onGesture, true);
};
