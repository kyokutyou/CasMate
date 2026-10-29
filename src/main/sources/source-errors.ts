export class NonRetryableSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableSourceError';
  }
}

export class WaitingSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WaitingSourceError';
  }
}

export function createSourceHttpError(service: string, status: number): Error {
  const message = `${service} HTTP ${status}`;
  const retryable = status === 408 || status === 425 || status === 429 || status >= 500;
  return retryable ? new Error(message) : new NonRetryableSourceError(message);
}
