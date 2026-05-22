import { readFile } from 'node:fs/promises';

import Handlebars from 'handlebars';

export class TemplateEngine {
  private readonly handlebars: typeof Handlebars;

  constructor() {
    this.handlebars = Handlebars.create();
    this.registerHelpers();
  }

  async render(templatePath: string, context: Record<string, unknown>): Promise<string> {
    const templateSource = await readFile(templatePath, 'utf8');
    const template = this.handlebars.compile(templateSource);
    return template(context);
  }

  private registerHelpers(): void {
    this.handlebars.registerHelper(
      'if_eq',
      function ifEq(
        this: unknown,
        left: unknown,
        right: unknown,
        options: Handlebars.HelperOptions,
      ) {
        return left === right ? options.fn(this) : options.inverse(this);
      },
    );
    this.handlebars.registerHelper('join', (value: unknown[], separator = ', ') =>
      Array.isArray(value) ? value.join(separator) : '',
    );
    this.handlebars.registerHelper('uppercase', (value: string) => value.toUpperCase());
    this.handlebars.registerHelper('lowercase', (value: string) => value.toLowerCase());
    this.handlebars.registerHelper('slugify', (value: string) =>
      value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, ''),
    );
    this.handlebars.registerHelper('date', () => new Date().toISOString().slice(0, 10));
  }
}
