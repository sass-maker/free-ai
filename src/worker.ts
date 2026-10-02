import { WorkerEntrypoint } from 'cloudflare:workers';
import app, { recordAnalytics } from './index';
import { fetchFleetRequest, isFleetProject, runFleetNative } from './fleet-gateway';
import type { Env } from './types';

export class FleetGateway extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return fetchFleetRequest(request, this.env, async (forwarded) =>
      app.fetch(forwarded, this.env, this.ctx)
    );
  }

  async run(project: string, model: string, input: unknown): Promise<unknown> {
    let outcome: 'ok' | 'error' = 'error';
    try {
      const result = await runFleetNative(this.env, project, model, input);
      outcome = 'ok';
      return result;
    } finally {
      if (isFleetProject(project))
        this.ctx.waitUntil(
          recordAnalytics({
            db: this.env.GATEWAY_DB,
            projectId: project,
            outcome,
            provider: 'workers_ai',
            model,
          })
        );
    }
  }
}

export default app;
export { HealthStateDO, IpRateLimitDO, NeuronBudgetDO } from './index';
