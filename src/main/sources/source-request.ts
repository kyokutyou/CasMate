const SOURCE_REQUEST_TIMEOUT_MS = 30_000;

/** Keep the request deadline active until its response body has been read. */
export async function withSourceRequestDeadline<T>(
  service: string,
  signal: AbortSignal,
  request: (requestSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const controller = new AbortController();
  let abort!: () => void;
  let timer!: NodeJS.Timeout;
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => {
      controller.abort(signal.reason);
      reject(signal.reason);
    };
    signal.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      const error = new Error(`${service}の応答が30秒以内に完了しないため再接続します。`);
      controller.abort(error);
      reject(error);
    }, SOURCE_REQUEST_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([request(controller.signal), cancelled]);
    signal.throwIfAborted();
    return result;
  } catch (error) {
    controller.abort(error);
    throw error;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}
