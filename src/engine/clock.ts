/** The one clock every timestamp in the app uses (camera frames, reveals, audio). */
export const now = (): number => performance.now();

type FrameTask = { id: number; at: number; fn: (frameTime: number) => void };

/**
 * Runs each task on the first animation frame whose timestamp is >= its deadline, and
 * hands it that frame time. A state change committed synchronously inside the task paints
 * on that same frame, so the frame time is the honest "this is when it appeared" stamp
 * (setTimeout fires between frames and can't give you that).
 */
export class FrameScheduler {
  private tasks: FrameTask[] = [];
  private handle = 0;
  private seq = 0;

  at(time: number, fn: (frameTime: number) => void): () => void {
    const task = { id: ++this.seq, at: time, fn };
    const i = this.tasks.findIndex((t) => t.at > time);
    if (i === -1) this.tasks.push(task);
    else this.tasks.splice(i, 0, task);
    if (!this.handle) this.handle = requestAnimationFrame(this.tick);
    return () => {
      this.tasks = this.tasks.filter((t) => t.id !== task.id);
    };
  }

  after(ms: number, fn: (frameTime: number) => void): () => void {
    return this.at(now() + ms, fn);
  }

  clear(): void {
    this.tasks = [];
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
  }

  private tick = (frameTime: number): void => {
    this.handle = 0;
    while (this.tasks.length && this.tasks[0].at <= frameTime) {
      this.tasks.shift()!.fn(frameTime);
    }
    if (this.tasks.length && !this.handle) this.handle = requestAnimationFrame(this.tick);
  };
}
