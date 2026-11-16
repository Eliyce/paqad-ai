export class ReviewRefusal extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'ReviewRefusal';
  }
}
