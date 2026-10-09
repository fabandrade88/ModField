export class Emitter<E> {
  private listeners: { [K in keyof E]?: Set<(v: E[K]) => void> } = {};

  on<K extends keyof E>(event: K, cb: (v: E[K]) => void): () => void {
    (this.listeners[event] ??= new Set()).add(cb);
    return () => this.listeners[event]?.delete(cb);
  }

  emit<K extends keyof E>(event: K, value: E[K]): void {
    this.listeners[event]?.forEach((cb) => cb(value));
  }
}
