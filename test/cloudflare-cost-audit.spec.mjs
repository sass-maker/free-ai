import { describe, expect, it } from 'vitest';

import { auditCloudflareCostConfig } from '../scripts/audit-cloudflare-costs.mjs';

const baseToml = `
name = "free-ai-gateway"

[ai]
binding = "AI"

[[durable_objects.bindings]]
name = "NEURON_BUDGET"
class_name = "NeuronBudgetDO"

[vars]
WORKERS_AI_ENABLED = "true"

[limits]
cpu_ms = 10
`;

describe('Cloudflare cost audit', () => {
  it('allows Workers AI when the neuron budget guard is present and capped', () => {
    const result = auditCloudflareCostConfig(baseToml, 'test.toml', { dailyNeuronCap: 9_500 });

    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.warnings.join('\n')).toContain('caps committed usage at 9500 neurons/day');
  });

  it('fails enabled Workers AI when the neuron budget guard is missing', () => {
    const result = auditCloudflareCostConfig(
      baseToml.replace(
        /\[\[durable_objects\.bindings\]\]\nname = "NEURON_BUDGET"\nclass_name = "NeuronBudgetDO"\n/,
        '',
      ),
      'test.toml',
      { dailyNeuronCap: 9_500 },
    );

    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('without the NEURON_BUDGET Durable Object guard');
  });

  it('fails enabled Workers AI when the committed neuron cap exceeds the buffer', () => {
    const result = auditCloudflareCostConfig(baseToml, 'test.toml', { dailyNeuronCap: 10_000 });

    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('Keep the committed cap at or below 9500 neurons/day');
  });

  it('still fails paid-plan CPU limits', () => {
    const result = auditCloudflareCostConfig(baseToml.replace('cpu_ms = 10', 'cpu_ms = 50'), 'test.toml', {
      dailyNeuronCap: 9_500,
    });

    expect(result.ok).toBe(false);
    expect(result.failures.join('\n')).toContain('free-plan CPU limit is 10ms');
  });
});
