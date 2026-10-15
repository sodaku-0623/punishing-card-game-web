/**
 * Node.js / Vitest 环境下的 cloudflare:workers 运行时桩实现
 */
export class DurableObject {
  ctx: DurableObjectState;
  env: unknown;
  constructor(ctx: DurableObjectState, env: unknown) {
    this.ctx = ctx;
    this.env = env;
  }
}
