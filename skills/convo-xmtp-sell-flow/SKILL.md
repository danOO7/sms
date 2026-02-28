---
name: convo-xmtp-sell-flow
description: Design and implement a Convo + XMTP private selling flow triggered by a web CTA like "Sell my stuff," where each click creates a new private channel/session via QR code and moves the user conversation into that channel. Use when defining UX flow, backend/session architecture, QR/deep-link handoff, privacy boundaries, and per-interaction channel lifecycle.
---

# Convo XMTP Sell Flow

## Overview
Define a reliable pattern for "click CTA → show QR → join private channel → continue conversation" using Convo/XMTP, with strict one-click-per-private-channel isolation.

## Workflow

1. Confirm the event contract for the CTA trigger.
2. Create a new interaction record and generate a unique channel context.
3. Mint a Convo invite/deep link tied to that interaction.
4. Render a QR code for that link in the web UI.
5. Detect successful join/handshake and mark interaction as active.
6. Route all subsequent conversation messages to that private channel only.
7. Close/archive interaction when completed or expired.

## Implementation Rules

- Generate a fresh `interactionId` for every "Sell my stuff" click.
- Never reuse private channels across interactions.
- Keep web-session state and channel state linked by `interactionId`.
- Treat QR payload as single-use or short-lived whenever possible.
- Store minimal metadata needed for recovery and auditing.
- Enforce channel membership/privacy checks before processing messages.

## Canonical Data Model

Use these core records:

- `Interaction`
  - `interactionId`
  - `createdAt`
  - `status` (`created | qr_issued | joined | active | closed | expired`)
  - `channelId`
  - `inviteLink`
  - `expiresAt`

- `ChannelBinding`
  - `channelId`
  - `interactionId`
  - `privacyMode` (`private`)
  - `participants[]`

## Pseudocode

```text
onSellMyStuffClick(userContext):
  interactionId = uuid()
  channel = createPrivateConvoChannel(interactionId)
  invite = createInviteLink(channel.id, ttl=short)
  saveInteraction(interactionId, channel.id, invite, status="qr_issued")
  return qrCode(invite)

onConvoJoin(channelId, participant):
  interaction = findByChannelId(channelId)
  validate(interaction.status in ["qr_issued", "joined"])
  addParticipant(channelId, participant)
  updateInteraction(interaction.id, status="active")

onInboundMessage(channelId, msg):
  interaction = findByChannelId(channelId)
  rejectIfMissingOrNotPrivate(interaction)
  processMessage(interaction.id, msg)
```

## Failure Handling

- If QR expires before join: issue a replacement invite for the same interaction (or create a new interaction based on product policy).
- If channel creation fails: do not render QR; return recoverable error and retry option.
- If duplicate click storms occur: debounce in UI and enforce idempotency server-side per request token.

## References

- Read `references/api-spec.md` for implementation-ready endpoint contracts.
- Read `references/node-ts-integration.md` for Node/TypeScript architecture and provider abstraction.
- Read `references/architecture-notes.md` for sequence, API boundaries, and security review prompts.
- Read `references/convo-selling-agent-workflow.md` for post-QR conversation orchestration (intake → photos → condition → market research → listing approval).
- Read `references/listing-template.md` for listing draft output format and approval prompt.
