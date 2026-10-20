/// <reference types="node" />
/* eslint-disable no-console */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the payload is untyped
const value: any = 1;
const other = 2; // eslint-disable-line no-unused-vars
/* eslint-enable no-console */
// @ts-expect-error the value is a number on purpose
const wrong: string = 3;
// @ts-ignore
const ignored: string = 4;
// prettier-ignore
const grid = [1,0,
              0,1];
/* istanbul ignore next */
const a = () => 1;
/* c8 ignore next */
const b = () => 2;
/* v8 ignore start */
const c = () => 3;
/* v8 ignore stop */
const load = (name: string) => import(/* @vite-ignore */ name);
export { value, other, wrong, ignored, grid, a, b, c, load };
