/** Fixed-size circular buffer. `total` keeps counting after old items drop out. */
export class Ring<T> {
  private items: (T | undefined)[];
  private start = 0;
  size = 0;
  total = 0;

  constructor(readonly capacity: number) {
    this.items = new Array<T | undefined>(capacity);
  }

  push(item: T): void {
    const i = (this.start + this.size) % this.capacity;
    this.items[i] = item;
    if (this.size < this.capacity) this.size++;
    else this.start = (this.start + 1) % this.capacity;
    this.total++;
  }

  /** The newest `n` items, newest last. */
  last(n: number): T[] {
    const k = Math.min(n, this.size);
    const out: T[] = [];
    for (let j = this.size - k; j < this.size; j++) out.push(this.items[(this.start + j) % this.capacity]!);
    return out;
  }

  clear(): void {
    this.items = new Array<T | undefined>(this.capacity);
    this.start = this.size = this.total = 0;
  }
}
