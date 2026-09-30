import { Page } from "@playwright/test";
export type AudioEvent = { type: "tone" | "noise"; frequency?: number };
export async function observeAudio(page: Page) {
  await page.addInitScript(() => {
    const stats = window as unknown as {
      audioEvents: { type: string; frequency?: number }[];
      audioContexts: number;
    };
    stats.audioEvents = [];
    stats.audioContexts = 0;
    const Native = AudioContext;
    window.AudioContext = class extends Native {
      constructor(options?: AudioContextOptions) {
        super(options);
        stats.audioContexts++;
      }
      createOscillator() {
        const oscillator = super.createOscillator();
        let frequency = 0;
        const set = oscillator.frequency.setValueAtTime.bind(
          oscillator.frequency,
        );
        oscillator.frequency.setValueAtTime = (value, time) => {
          frequency = value;
          return set(value, time);
        };
        const start = oscillator.start.bind(oscillator);
        oscillator.start = (when) => {
          stats.audioEvents.push({ type: "tone", frequency });
          start(when);
        };
        return oscillator;
      }
      createBufferSource() {
        const source = super.createBufferSource(),
          start = source.start.bind(source);
        source.start = (when, offset, duration) => {
          stats.audioEvents.push({ type: "noise" });
          start(when, offset, duration);
        };
        return source;
      }
    };
  });
}
export function audioEvents(page: Page): Promise<AudioEvent[]> {
  return page.evaluate(
    () => (window as unknown as { audioEvents: AudioEvent[] }).audioEvents,
  );
}
