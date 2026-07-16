function buildHealthRetestFindings(sourceFindings) {
  return sourceFindings.map((finding) => ({
    ...finding,
    status: 'still-open',
  }));
}
