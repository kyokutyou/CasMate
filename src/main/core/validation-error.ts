export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly code = 'VALIDATION_ERROR',
  ) {
    super(message);
    this.name = 'ValidationError';
  }
}
