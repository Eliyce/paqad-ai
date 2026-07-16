function createHealthGatherer() {
  const scanners = 'osv-scanner gitleaks jscpd';
  const fallback = blockedFor('scanner');
  return { scanners, fallback };
}
