export class JourneyRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'JourneyRefusal';
  }
}
