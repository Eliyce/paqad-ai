export function studlySkillName(name: string): string {
  return name
    .split('-')
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join('');
}

export function skillTestDirectories(name: string): string[] {
  return [`tests/skills/${name}`, `tests/Feature/Skills/${studlySkillName(name)}`];
}

export function agentTestDirectories(name: string): string[] {
  return [`tests/agents/${name}`, `tests/Feature/Agents/${studlySkillName(name)}`];
}
