export function stopHookActiveFromStdin(stdin) {
  try {
    const parsed = JSON.parse(stdin);
    return parsed?.stop_hook_active === true;
  } catch {
    return false;
  }
}
