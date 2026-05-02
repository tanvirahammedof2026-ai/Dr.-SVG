/**
 * Simple Web Audio synthesizer for UI sounds
 */

class SoundEngine {
  private ctx: AudioContext | null = null;

  private getCtx() {
    if (!this.ctx) {
      this.ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    return this.ctx;
  }

  play(type: 'click' | 'success' | 'error' | 'process' | 'hover') {
    const ctx = this.getCtx();
    const now = ctx.currentTime;

    const playTone = (freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.05) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1500, now);
      
      osc.type = type;
      osc.frequency.setValueAtTime(freq, now);
      
      gain.gain.setValueAtTime(volume, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
      
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      
      osc.start(now);
      osc.stop(now + duration);
    };

    switch (type) {
      case 'click':
        playTone(800, 0.08, 'sine', 0.03);
        break;
      case 'success':
        playTone(523.25, 0.3, 'sine', 0.04);
        setTimeout(() => playTone(659.25, 0.2, 'sine', 0.03), 80);
        setTimeout(() => playTone(783.99, 0.2, 'sine', 0.02), 160);
        break;
      case 'error':
        playTone(180, 0.25, 'triangle', 0.05);
        break;
      case 'process':
        playTone(1500, 0.04, 'sine', 0.01);
        break;
      case 'hover':
        playTone(1200, 0.04, 'sine', 0.005);
        break;
    }
  }
}

export const sounds = new SoundEngine();
