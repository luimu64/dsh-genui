/**
 * ComfyUI may still be cold-starting when a saved conversation replays its Query(), and a
 * transient failure must not leave a permanent red box under the image. This wrapper retries
 * the render a few times with a growing delay; the Rust side already waits for liveness, so
 * a couple of attempts covers a slow boot or a momentarily busy queue.
 */

export async function withRetry<T>(
  run: () => Promise<T>,
  attempts = 4,
  baseDelayMs = 1500,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await run();
    } catch (err) {
      lastError = err;
      const message = String(err);
      // A bad prompt or a rejected graph will never succeed; only retry transport problems.
      const transient =
        /fetch failed|ECONNREFUSED|ECONNRESET|timed out|did not come up|unreachable|connection|genui request failed: 5\d\d/i.test(
          message,
        );
      if (!transient || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastError;
}
