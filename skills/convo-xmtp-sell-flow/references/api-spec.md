# API Spec (Implementation-Ready)

Base path: `/api/v1`
Content type: `application/json`

## 1) Create Interaction + QR

`POST /interactions/sell`

### Request

```json
{
  "requestId": "optional-idempotency-token",
  "source": "web",
  "userContext": {
    "anonymousId": "optional"
  }
}
```

### Response `201`

```json
{
  "interactionId": "int_4f4f2...",
  "status": "qr_issued",
  "channelId": "chan_9ab...",
  "inviteLink": "https://convo.example/invite/....",
  "qrDataUrl": "data:image/png;base64,...",
  "expiresAt": "2026-02-28T18:20:00.000Z"
}
```

### Errors

- `409` idempotency conflict
- `503` channel provider unavailable

## 2) Join Webhook (Convo/XMTP)

`POST /webhooks/convo/join`

Headers:
- `x-signature`: provider signature

### Request

```json
{
  "channelId": "chan_9ab...",
  "participant": {
    "walletAddress": "0x...",
    "did": "did:xmtp:..."
  },
  "timestamp": "2026-02-28T18:01:02.000Z"
}
```

### Response

`200 { "ok": true }`

## 3) Inbound Message Webhook

`POST /webhooks/convo/message`

Headers:
- `x-signature`

### Request

```json
{
  "channelId": "chan_9ab...",
  "messageId": "msg_...",
  "sender": "0x...",
  "text": "I want to sell my bike",
  "timestamp": "2026-02-28T18:02:00.000Z"
}
```

### Response

`200 { "ok": true, "interactionId": "int_..." }`

## 4) Close Interaction

`POST /interactions/{interactionId}/close`

### Request

```json
{
  "reason": "completed"
}
```

### Response

```json
{
  "interactionId": "int_...",
  "status": "closed",
  "closedAt": "2026-02-28T18:10:00.000Z"
}
```

## Data Contracts

## Interaction

```json
{
  "interactionId": "string",
  "createdAt": "ISO-8601",
  "status": "created|qr_issued|joined|active|closed|expired",
  "channelId": "string",
  "inviteLink": "string",
  "expiresAt": "ISO-8601",
  "closedAt": "ISO-8601|null"
}
```

## Security Requirements

- Validate webhook signatures before processing.
- Enforce one active `channelId` binding per `interactionId`.
- Reject messages for missing/inactive bindings with `404/410`.
- Use short invite TTL (recommended: 10 minutes).
- Store minimal participant metadata.
