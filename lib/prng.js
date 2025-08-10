// Pseudo-Random Number Generator for reproducible randomness
export class PRNG {
  constructor(seed) {
    this.state = seed || Math.floor(Math.random() * 0xFFFFFFFF);
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (this.state >>> 0) / 0xFFFFFFFF;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min)) + min;
  }

  selectUnique(count, n) {
    if (count > n) count = n;
    const selected = new Set();
    while (selected.size < count) {
      selected.add(this.nextInt(0, n));
    }
    return [...selected];
  }
}