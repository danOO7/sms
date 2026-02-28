# Node/TypeScript Integration Notes (Convo + XMTP)

## Goal
Implement the flow with Node/TS backend and clean provider abstraction so Convo/XMTP SDK details are isolated from HTTP handlers.

## Suggested Structure

```text
src/
  api/
    interactions.ts
    webhooks.ts
  domain/
    interaction-service.ts
    types.ts
  providers/
    convo-xmtp-provider.ts
    provider-interface.ts
  infra/
    repo.ts
    signature.ts
```

## Provider Interface

```ts
export interface PrivateChannelProvider {
  createPrivateChannel(params: { interactionId: string }): Promise<{ channelId: string }>;
  createInvite(params: { channelId: string; ttlSeconds: number }): Promise<{ inviteLink: string; expiresAt: string }>;
  validateWebhookSignature(rawBody: string, signature: string): boolean;
}
```

## Interaction Service Contract

```ts
createInteraction(input: { requestId?: string }): Promise<{
  interactionId: string;
  channelId: string;
  inviteLink: string;
  expiresAt: string;
}>;

markJoined(input: { channelId: string; participant: string }): Promise<void>;

handleInboundMessage(input: { channelId: string; sender: string; text: string }): Promise<{ interactionId: string }>;
```

## XMTP/Convo Mapping Guidance

- Map `interactionId` to channel topic/metadata for reverse lookup.
- Keep provider-specific IDs in a dedicated subobject if needed:
  - `provider.channelRef`
  - `provider.inviteRef`
- Normalize wallet/DID into a canonical participant identity.

## Operational Guidance

- Add idempotency key handling in `createInteraction`.
- Add queue/retry for outbound provider API calls.
- Log with `interactionId`, `channelId`, `messageId` correlation keys.
- Add dead-letter path for webhook parse/validation failures.
