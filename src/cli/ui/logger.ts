import chalk from 'chalk';

export const logger = {
  info(message: string): string {
    return chalk.blue(message);
  },
  success(message: string): string {
    return chalk.green(message);
  },
  warning(message: string): string {
    return chalk.yellow(message);
  },
  error(message: string): string {
    return chalk.red(message);
  },
};
