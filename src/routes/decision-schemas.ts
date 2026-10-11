import { z } from '@hono/zod-openapi';
import { projectIdSchema } from './shared-schemas';

const questionBase = { id: z.string().min(1).max(128), prompt: z.string().min(1).max(2000) };
const question = z.discriminatedUnion('type', [
  z
    .object({
      ...questionBase,
      type: z.literal('choice'),
      options: z.array(z.string().min(1).max(256)).min(1).max(64),
    })
    .strict()
    .refine((q) => new Set(q.options).size === q.options.length),
  z
    .object({
      ...questionBase,
      type: z.literal('score'),
      min: z.number().finite(),
      max: z.number().finite(),
    })
    .strict()
    .refine((q) => q.max > q.min),
  z.object({ ...questionBase, type: z.literal('bool') }).strict(),
]);
const engine = z
  .object({
    engine: z.enum(['free_ai', 'jev']).default('free_ai'),
    model: z.string().min(1).max(200).default('auto'),
  })
  .strict();
const common = {
  project_id: projectIdSchema,
  state: z.record(z.string(), z.unknown()),
  questions: z
    .array(question)
    .min(1)
    .max(60)
    .refine((questions) => new Set(questions.map((q) => q.id)).size === questions.length),
  limits: z
    .object({
      deadline_ms: z.number().int().min(1000).max(60000).default(30000),
      max_output_tokens: z.number().int().min(128).max(4096).default(2048),
      max_cost_usd: z.literal(0).default(0),
    })
    .strict()
    .default({ deadline_ms: 30000, max_output_tokens: 2048, max_cost_usd: 0 }),
};

export const decisionRequestSchema = z.object({ ...common, ...engine.shape }).strict();
export const comparisonRequestSchema = z
  .object({
    ...common,
    engines: z
      .array(engine)
      .min(2)
      .max(4)
      .refine(
        (engines) => new Set(engines.map((e) => `${e.engine}:${e.model}`)).size === engines.length
      ),
  })
  .strict();
export type DecisionInput = z.infer<typeof decisionRequestSchema>;
export type DecisionEngine = z.infer<typeof engine>;

const answerSchema = z
  .object({
    id: z.string().min(1).max(128),
    status: z.enum(['answered', 'abstained']),
    value: z.union([z.string().max(256), z.number().finite(), z.boolean(), z.null()]),
    reason: z.string().min(1).max(2000),
  })
  .strict();
const decisionOutputSchema = z.object({ answers: z.array(answerSchema).max(60) }).strict();
export type DecisionAnswer = z.infer<typeof answerSchema>;

export function validateDecisionAnswers(
  value: unknown,
  questions: DecisionInput['questions']
): DecisionAnswer[] {
  const { answers } = decisionOutputSchema.parse(value);
  if (
    answers.length !== questions.length ||
    new Set(answers.map((a) => a.id)).size !== answers.length
  )
    throw new Error('Missing or repeated answers');
  return questions.map((q) => {
    const answer = answers.find((a) => a.id === q.id);
    if (!answer) throw new Error('Unknown or missing question');
    if (answer.status === 'abstained') {
      if (answer.value !== null) throw new Error('Abstention must have a null value');
    } else if (!validValue(q, answer.value)) throw new Error('Invalid typed answer');
    return answer;
  });
}

function validValue(
  q: DecisionInput['questions'][number],
  value: DecisionAnswer['value']
): boolean {
  if (q.type === 'choice') return typeof value === 'string' && q.options.includes(value);
  if (q.type === 'score') return typeof value === 'number' && value >= q.min && value <= q.max;
  return typeof value === 'boolean';
}
