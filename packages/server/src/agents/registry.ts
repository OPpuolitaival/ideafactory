class PipelineRegistry {
  private running = new Map<string, AbortController>();

  register(sessionId: string): AbortController {
    this.abort(sessionId);
    const controller = new AbortController();
    this.running.set(sessionId, controller);
    return controller;
  }

  abort(sessionId: string): void {
    const existing = this.running.get(sessionId);
    if (existing) {
      existing.abort();
      this.running.delete(sessionId);
    }
  }

  complete(sessionId: string): void {
    this.running.delete(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.running.has(sessionId);
  }
}

export const pipelineRegistry = new PipelineRegistry();
