import ora, { type Ora } from 'ora';

import { formatDuration } from '../formatting/formatDuration.js';

/**
 * Create an Ora spinner that automatically records elapsed time on success/fail.
 *
 * Wraps the `ora` spinner to append a human-readable elapsed duration
 * when `succeed` or `fail` is called.
 *
 * @param text - The initial spinner text.
 * @returns An Ora spinner instance with timing support.
 */
export function createSpinner(text: string): Ora {
  const startInstant = Temporal.Now.instant();
  const spinner = ora({ text, stream: process.stdout, discardStdin: false });

  return {
    get text() { return spinner.text; },
    set text(val: string) { spinner.text = val; },
    get isSpinning() { return spinner.isSpinning; },
    start(t?: string) { spinner.start(t); return this; },
    stop() { spinner.stop(); return this; },
    succeed(t?: string) {
      const elapsed = formatDuration(startInstant, Temporal.Now.instant());
      spinner.succeed(`${t ?? text} (${elapsed})`);
      return this;
    },
    fail(t?: string) {
      const elapsed = formatDuration(startInstant, Temporal.Now.instant());
      spinner.fail(`${t ?? text} (${elapsed})`);
      return this;
    },
    warn(t?: string) { spinner.warn(t); return this; },
    info(t?: string) { spinner.info(t); return this; },
    stopAndPersist(opts?) { spinner.stopAndPersist(opts); return this; },
    clear() { spinner.clear(); return this; },
    render() { spinner.render(); return this; },
    frame() { return spinner.frame(); },
  } as Ora;
}
