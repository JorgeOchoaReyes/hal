/**
 * Tiny typed event emitter — enough for streaming run events to the UI without
 * pulling in a dependency. Node's EventEmitter is untyped, so we wrap a Set.
 */
export type Listener<T> = (event: T) => void;

export class TypedEmitter<T> {
  private listeners = new Set<Listener<T>>();

  on(listener: Listener<T>): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: T): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        // A broken listener must not break the run.
        // eslint-disable-next-line no-console
        console.error("[hal] event listener threw", err);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
