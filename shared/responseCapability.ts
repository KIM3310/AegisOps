import { z } from 'zod';

const ResponseWorkflowCapabilitySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('unavailable'), reason: z.enum(['static', 'configuration']) }),
  z.strictObject({
    kind: z.literal('cloud-response'), storage: z.literal('d1'), authMode: z.literal('token'),
    scope: z.literal('shared-synthetic'), configured: z.literal(true),
  }),
]);

export type ResponseWorkflowCapability = z.infer<typeof ResponseWorkflowCapabilitySchema>;

export function parseResponseWorkflowCapability(input: unknown): ResponseWorkflowCapability {
  const result = ResponseWorkflowCapabilitySchema.safeParse(input);
  return result.success ? result.data : { kind: 'unavailable', reason: 'configuration' };
}
