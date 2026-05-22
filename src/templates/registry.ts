import fg from 'fast-glob';
import { basename, relative } from 'pathe';

export interface TemplateDescriptor {
  name: string;
  path: string;
  relativePath: string;
}

export class TemplateRegistry {
  constructor(private readonly templatesRoot: string) {}

  async discover(): Promise<TemplateDescriptor[]> {
    const files = await fg('**/*.hbs', {
      cwd: this.templatesRoot,
      absolute: true,
      onlyFiles: true,
    });

    return files.sort().map((path) => ({
      name: basename(path),
      path,
      relativePath: relative(this.templatesRoot, path),
    }));
  }
}
