// In-process queue for every formal ktx.yaml write. Single-process only.
let ktxYamlWriteTail: Promise<unknown> = Promise.resolve();

export function withKtxYamlWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = ktxYamlWriteTail.then(fn, fn);
  ktxYamlWriteTail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
