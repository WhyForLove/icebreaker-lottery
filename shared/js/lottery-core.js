(function (root) {
  'use strict';
  class Lottery {
    constructor(ids) {
      this.ids = [...ids];
      this.remaining = [...ids];
      this.past = [];
      this.current = null;
      this.replay = [];
      this.backtrack = null;
    }
    draw(randomIndex) {
      if (!this.replay.length && !this.remaining.length) return false;
      // History is a fixed timeline: replay its next item before drawing anew.
      this.backtrack = null;
      if (this.current !== null) this.past.push(this.current);
      if (this.replay.length) this.current = this.replay.shift();
      else this.current = this.remaining.splice(randomIndex(this.remaining.length), 1)[0];
      return true;
    }
    back() {
      if (!this.past.length) return false;
      this.replay.unshift(this.current);
      this.current = this.past.pop();
      this.backtrack = true;
      return true;
    }
    backTo(id) {
      if (!this.past.includes(id)) return false;
      while (this.current !== id) this.back();
      return true;
    }
    pending() { return [...this.replay, ...this.remaining]; }
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = Lottery;
  else root.Lottery = Lottery;
})(globalThis);
