/**
 * One in-flight operation per key. Rejections do not poison later work, while
 * the rejection still reaches the Hocuspocus hook that submitted the task.
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>()

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve()
    const task = previous.catch(() => undefined).then(work)
    this.tails.set(key, task)

    const cleanup = () => {
      if (this.tails.get(key) === task) this.tails.delete(key)
    }
    void task.then(cleanup, cleanup)

    return task
  }

  async flush(): Promise<void> {
    while (this.tails.size > 0) {
      await Promise.allSettled([...this.tails.values()])
    }
  }
}
