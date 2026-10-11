/**
 * Execute a list of tasks with bounded concurrency.
 *
 * Distributes items across a fixed number of worker "slots". Each slot
 * pulls the next unprocessed item and runs the handler. Errors from
 * individual tasks are collected — if any fail, the first error is thrown
 * (or an AggregateError if multiple fail).
 *
 * @template T - Input item type.
 * @template R - Result type returned by the handler.
 * @param items - Array of items to process.
 * @param concurrency - Maximum number of concurrent tasks.
 * @param handler - Async function to process each item.
 * @returns Array of results in submission order.
 * @throws {Error} If a single task fails.
 * @throws {AggregateError} If multiple tasks fail.
 */
export async function promisePool<T, R = void>(
  items: T[],
  concurrency: number,
  handler: (item: T) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];

  const effective = Math.min(Math.max(1, concurrency), items.length);
  const nextIndex = { value: 0 };
  const errors: Error[] = [];
  const results: R[] = [];

  const worker = async (): Promise<void> => {
    while (nextIndex.value < items.length) {
      const idx = nextIndex.value;
      nextIndex.value += 1;
      try {
        // eslint-disable-next-line no-await-in-loop
        results.push(await handler(items[idx]));
      } catch (err) {
        errors.push(err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  const workers = Array.from({ length: effective }, () => worker());
  await Promise.all(workers);

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(errors, `${errors.length} of ${items.length} tasks failed`);
  }

  return results;
}
