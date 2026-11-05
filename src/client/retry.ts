/**
 * ComfyUI may still be cold-starting when a saved conversation replays its Query(), and a
 * transient failure must not leave a permanent red box under the image. This wrapper retries
 * the render a few times with a growing delay; the host already waits for liveness, so
 * a couple of attempts covers a slow boot or a momentarily busy queue.
 */

/**
 * Whether another attempt can plausibly succeed.
 *
 *  - transport: the server was not listening, dropped the socket, or answered 5xx;
 *  - 404: the harness restarted without the genui bundle mounted yet, so the route was not
 *    there for a moment. That is exactly the window a batch of five posts through, and it
 *    used to fail every frame permanently — "it completely failed once";
 *  - an unusable sample: the host drops a frame that came back as noise and says so. Every
 *    POST picks a fresh seed, so a second attempt is a different picture, not a repeat.
 *
 * A rejected graph or a bad prompt is still not retried: those are the same answer forever.
 */
function transientFailure(message: string): boolean {
  if (/genui request failed: (5\d\d|404)/i.test(message)) return true;
  if (/came back unusable|finished with no images/i.test(message)) return true;
  return /fetch failed|ECONNREFUSED|ECONNRESET|timed out|did not come up|unreachable|connection|Failed to fetch|NetworkError|load failed/i.test(
    message,
  );
}

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
      if (!transientFailure(String(err)) || i === attempts - 1) break;
      await new Promise((r) => setTimeout(r, baseDelayMs * (i + 1)));
    }
  }
  throw lastError;
}
