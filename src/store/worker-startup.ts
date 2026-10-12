/** Do not abort module loading just because an unstarted job is superseded. */
export class WorkerStartup {
  ready = false;
  private queued: Array<() => void> = [];
  enqueue(send: () => void): void {
    if (this.ready) send();
    else this.queued.push(send);
  }
  cancelQueued(): void { this.queued = []; }
  markReady(): void {
    if (this.ready) return;
    this.ready = true;
    const queued = this.queued;
    this.queued = [];
    for (const send of queued) send();
  }
}
