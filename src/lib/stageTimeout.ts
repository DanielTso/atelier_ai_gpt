// Hard time bound for one best-effort stage of the chat path (query rewrite, the
// query embedding, rerank). The signal is handed to the AI SDK call so the request
// itself is cancelled, and the race guarantees the bound even when the callee
// does not honour the signal (a stalled settings read, a mocked call). On timeout
// the returned promise rejects; each caller decides what to degrade to.
export function withStageTimeout<T>(ms: number, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const signal = AbortSignal.timeout(ms)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new Error(`stage timed out after ${ms}ms`))
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve()
      .then(() => run(signal))
      .then(
        value => { signal.removeEventListener('abort', onAbort); resolve(value) },
        error => { signal.removeEventListener('abort', onAbort); reject(error) },
      )
  })
}
