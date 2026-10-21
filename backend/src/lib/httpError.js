// Error with an HTTP status. The global error handler exposes `message` to the
// client for status < 500, so keep messages short and user-facing.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}
