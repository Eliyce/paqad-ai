export function studlySkillName(name: string): string {
  return name
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

export function skillTestDirectories(
  name: string,
  options: { paqadRepo?: boolean } = {},
): string[] {
  const dirs = [`tests/skills/${name}`, `tests/Feature/Skills/${studlySkillName(name)}`];
  return options.paqadRepo === true ? [`tests/unit/skills/${name}`, ...dirs] : dirs;
}

export function agentTestDirectories(name: string): string[] {
  return [`tests/agents/${name}`, `tests/Feature/Agents/${studlySkillName(name)}`];
}
