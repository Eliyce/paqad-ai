export async function runHealthAudit(result) {
  await writeJsonFile('cache.json', result);
  return result;
}
// report paths missing
