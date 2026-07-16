function runHealthAudit(gatherer) {
  const index = gatherer.loadIndex();
  const reason = 'the code-knowledge index has not been built';
  return index ?? reason;
}
