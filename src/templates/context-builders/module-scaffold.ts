export function buildModuleScaffoldContext(moduleName: string) {
  return {
    moduleName,
    title: moduleName.replace(/-/g, ' '),
  };
}
