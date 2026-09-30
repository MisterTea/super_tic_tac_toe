export type Sound = "x" | "o" | "win" | "lose";
// Short synthesized effects: no downloads and no audio until a user gesture.
export class GameSounds {
  private context?: AudioContext;
  private output?: GainNode;
  enabled = true;
  unlock() {
    try {
      if (!this.enabled) return;
      if (!this.context || this.context.state === "closed") {
        this.context = new AudioContext();
        this.output = this.context.createGain();
        this.output.gain.value = 0.3;
        this.output.connect(this.context.destination);
      }
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      /* Audio availability must never stop gameplay. */
    }
  }
  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (this.output && this.context)
      this.output.gain.setValueAtTime(
        enabled ? 0.3 : 0,
        this.context.currentTime,
      );
  }
  play(sound: Sound) {
    const context = this.context,
      output = this.output;
    if (!this.enabled || !context || !output || context.state !== "running")
      return;
    const start = context.currentTime;
    if (sound === "lose") {
      const length = 0.65,
        buffer = context.createBuffer(
          1,
          Math.ceil(context.sampleRate * length),
          context.sampleRate,
        );
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const noise = context.createBufferSource(),
        filter = context.createBiquadFilter(),
        gain = context.createGain();
      noise.buffer = buffer;
      filter.type = "bandpass";
      filter.Q.value = 0.8;
      filter.frequency.setValueAtTime(2200, start);
      filter.frequency.exponentialRampToValueAtTime(180, start + length);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.linearRampToValueAtTime(0.7, start + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, start + length);
      noise.connect(filter);
      filter.connect(gain);
      gain.connect(output);
      noise.onended = () => {
        noise.disconnect();
        filter.disconnect();
        gain.disconnect();
      };
      noise.start(start);
      noise.stop(start + length);
      return;
    }
    const notes =
      sound === "win"
        ? [523.25, 659.25, 783.99, 1046.5]
        : [sound === "x" ? 520 : 360];
    notes.forEach((frequency, index) => {
      const oscillator = context.createOscillator(),
        gain = context.createGain(),
        at = start + index * 0.13,
        duration = sound === "win" ? 0.35 : 0.16;
      oscillator.type = sound === "win" ? "triangle" : "sine";
      oscillator.frequency.setValueAtTime(frequency, at);
      if (sound !== "win")
        oscillator.frequency.exponentialRampToValueAtTime(
          frequency * 0.8,
          at + duration,
        );
      gain.gain.setValueAtTime(0.001, at);
      gain.gain.linearRampToValueAtTime(0.45, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.001, at + duration);
      oscillator.connect(gain);
      gain.connect(output);
      oscillator.onended = () => {
        oscillator.disconnect();
        gain.disconnect();
      };
      oscillator.start(at);
      oscillator.stop(at + duration);
    });
  }
  close() {
    void this.context?.close().catch(() => {});
    this.context = undefined;
    this.output = undefined;
  }
}
