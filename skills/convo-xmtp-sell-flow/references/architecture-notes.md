# Architecture Notes

## Sequence (Happy Path)

1. User clicks **Sell my stuff** on web app.
2. Backend creates `interactionId` and private Convo/XMTP channel.
3. Backend creates invite/deep link and returns QR payload.
4. Web app renders QR.
5. User scans QR in Convo client and joins private channel.
6. Join webhook/event confirms membership.
7. Backend marks interaction `active` and starts handling channel messages.
8. On completion, interaction is closed and channel archived per policy.

## API Boundary Checklist

- `POST /interactions/sell` → creates interaction + QR payload
- `POST /webhooks/convo/join` → join confirmation
- `POST /webhooks/convo/message` → inbound user message
- `POST /interactions/{id}/close` → close workflow

## Security/Privacy Prompts

- Does each interaction create a unique channel?
- Is invite URL signed and short-lived?
- Are webhook signatures validated?
- Is access denied if `channelId` is not bound to an active interaction?
- Is PII retention minimized and time-bounded?

## Product Decisions to Lock

- Whether expired QR regenerates invite on same interaction or new interaction
- Interaction inactivity timeout
- Channel archive/delete retention window
- Multi-device join behavior for the same user
