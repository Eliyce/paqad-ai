import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { cleanTempDirs, runScript, tempDir, writeTemp } from '../recipe-helpers.js';

afterEach(cleanTempDirs);

const SPEC = JSON.stringify({
  acceptance_criteria: [
    { id: 'AC-1', proof_type: 'automated' },
    { id: 'AC-12', proof_type: 'automated' },
    { id: 'AC-3', proof_type: 'manual' },
  ],
});

describe('check-ac-map.mjs across test languages', () => {
  const ONE = JSON.stringify({ acceptance_criteria: [{ id: 'AC-1', proof_type: 'automated' }] });

  it.each([
    ['pytest', 'tests_area/test_login.py', 'def test_ac_1_login():\n    pass\n'],
    ['pytest suffix', 'login_test.py', 'def test_AC_1():\n    pass\n'],
    ['RSpec', 'login_spec.rb', "it 'AC-1 logs in' do\nend\n"],
    ['JUnit', 'LoginTest.java', 'class LoginTest { @Test void ac1Login() {} }\n'],
    ['JUnit camel', 'LoginTests.kt', 'class LoginTests { @Test fun testAc1() {} }\n'],
    ['C#', 'LoginTests.cs', 'public class LoginTests { [Fact] public void AC1_Login() {} }\n'],
    ['Rust tests folder', 'tests/login.rs', '#[test]\nfn ac_1_login() {}\n'],
    ['Rust inline', 'login.rs', '#[cfg(test)]\nmod t { #[test]\nfn ac_1() {} }\n'],
    ['Go', 'login_test.go', 'func TestAC1(t *testing.T) {}\n'],
  ])('%s: reads the file and finds the criterion', async (_language, file, body) => {
    const root = tempDir();
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), body);
    const { json } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', ONE),
      root,
    ]);
    expect(json.unchecked).toBeUndefined();
    expect(json.ok).toBe(true);
  });

  it.each([
    ['pytest', 'test_login.py'],
    ['RSpec', 'login_spec.rb'],
    ['JUnit', 'LoginTest.java'],
    ['C#', 'LoginTests.cs'],
    ['Rust', 'tests/login.rs'],
  ])('%s: a read test file that does not name the criterion refuses', async (_language, file) => {
    const root = tempDir();
    mkdirSync(join(root, file, '..'), { recursive: true });
    writeFileSync(join(root, file), 'nothing about it, not even vac1 or trac-1\n');
    const { json } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', ONE),
      root,
    ]);
    expect(json.errors).toEqual(['AC-1 has no test that names it']);
  });

  it('lets a project through and says so when no test file can be read', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'main.zig'), 'test "AC-1" {}\n');
    const { json, exitCode } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', ONE),
      root,
    ]);
    expect(exitCode).toBe(0);
    expect(json.ok).toBe(true);
    expect(json.unchecked).toContain('no test file could be read');
  });

  it('counts a criterion at the end of a sentence, and does not read AC-1.7 as AC-1', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.test.ts'), '// covers AC-1.\n');
    const pass = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', ONE),
      root,
    ]);
    expect(pass.json.ok).toBe(true);
    writeFileSync(join(root, 'a.test.ts'), '// covers AC-1.7\n');
    const fail = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', ONE),
      root,
    ]);
    expect(fail.json.ok).toBe(false);
  });
});

describe('check-ac-map.mjs', () => {
  it('passes when every automated criterion is named by a test', async () => {
    const root = tempDir();
    mkdirSync(join(root, 'tests'));
    writeFileSync(
      join(root, 'tests/a.test.ts'),
      "it('AC-1 works', () => {}); it('AC-12', () => {});",
    );
    const { json } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', SPEC),
      root,
    ]);
    expect(json.ok).toBe(true);
  });

  it('does not read AC-12 as AC-1, and skips a manual criterion', async () => {
    const root = tempDir();
    writeFileSync(join(root, 'a.test.ts'), "it('AC-12 works', () => {});");
    const { json, exitCode } = await runScript('development-recipe', 'check-ac-map.mjs', [
      writeTemp('spec.json', SPEC),
      root,
    ]);
    expect(exitCode).toBe(1);
    expect(json.errors).toEqual(['AC-1 has no test that names it']);
  });
});
