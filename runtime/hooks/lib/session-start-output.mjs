export function mergeSessionStartOutput(stageOutput, teamText) {
  if (!teamText) return stageOutput;
  let base;
  try {
    base = stageOutput ? JSON.parse(stageOutput) : null;
  } catch {
    base = null;
  }
  const systemMessage = base?.systemMessage ? `${base.systemMessage}\n\n${teamText}` : teamText;
  const context = base?.hookSpecificOutput?.additionalContext;
  return `${JSON.stringify({
    systemMessage,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: context ? `${context}\n\n${teamText}` : teamText,
    },
  })}\n`;
}
