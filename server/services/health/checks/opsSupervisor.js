import { registerHealthCheck } from '../registry.js';
import { pingVertex } from '../../ops/agents/vertexRuntime.js';

registerHealthCheck('ops.supervisor', {
  label: 'Operations AI supervisor (Vertex runtime)',
  category: 'agent',
  timeoutMs: 25000,
  run: async () => {
    const { ok, model } = await pingVertex();
    return {
      status: ok ? 'ok' : 'fail',
      detail: ok ? `Supervisor Vertex runtime responded (${model}).` : 'Supervisor Vertex runtime returned no text.',
      error: ok ? undefined : 'empty response from Vertex',
      metrics: { model: model || null }
    };
  }
});
