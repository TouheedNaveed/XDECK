let globalAudioCtx: AudioContext | null = null;

/**
 * Plays a high-fidelity synthetic mechanical click sound using Web Audio API.
 * Fully supported on iOS Safari and mobile browsers.
 */
export function playTapSound(volumePercent: number) {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;

    if (!globalAudioCtx) {
      globalAudioCtx = new AudioContextClass();
    }

    if (globalAudioCtx.state === 'suspended') {
      globalAudioCtx.resume();
    }

    const ctx = globalAudioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    // Nice crisp mechanical switch pop/click sound: 
    // Start at 800Hz, drop down to 100Hz rapidly (in 40ms)
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.04);

    // Map 0-100 percent volume to gain values safely (max volume 0.35)
    const maxVolume = 0.35;
    const targetVolume = (volumePercent / 100) * maxVolume;

    gain.gain.setValueAtTime(targetVolume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

    osc.start(now);
    osc.stop(now + 0.04);
  } catch (e) {
    console.warn('[AUDIO] Tap sound failed:', e);
  }
}
