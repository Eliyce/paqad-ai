export function createHealthGatherer() {
  const tools = ['osv-scanner', 'gitleaks', 'jscpd'];
  const unavailable = tools.map((tool) => blockedFor(tool));
  return { tools, unavailable };
}
