// Test-owned process lifecycle; no application code imports this helper.
export async function stopHarnessChild(child, { graceMs = 1000, killMs = 1000 } = {}) {
  const exited = () => !child || child.exitCode !== null || child.signalCode !== null
  if (exited()) return true

  const signalAndWait = (signal, timeoutMs) => new Promise(resolve => {
    const finish = result => {
      clearTimeout(timer)
      child.removeListener('exit', onExit)
      child.removeListener('error', onError)
      resolve(result)
    }
    const onExit = () => finish(true)
    const onError = () => finish(false)
    const timer = setTimeout(() => finish(false), timeoutMs)
    // Subscribe before sending: an exit must never fall between kill and listener setup.
    child.once('exit', onExit)
    child.once('error', onError)
    if (exited()) finish(true)
    else {
      try { child.kill(signal) } catch { finish(false) }
    }
  })

  if (await signalAndWait('SIGTERM', graceMs)) return true
  if (exited()) return true
  return signalAndWait('SIGKILL', killMs)
}
