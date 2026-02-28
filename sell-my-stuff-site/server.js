import express from 'express';
import cors from 'cors';
import QRCode from 'qrcode';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

const app = express();
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH || './data/interactions.db';
const INVITE_TTL_MIN = Number(process.env.INVITE_TTL_MIN || 10);

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

const db = new Database(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS interactions (
    interaction_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    channel_id TEXT NOT NULL UNIQUE,
    invite_link TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    closed_at TEXT,
    provider_mode TEXT NOT NULL,
    participants_json TEXT NOT NULL DEFAULT '[]'
  );

  CREATE INDEX IF NOT EXISTS idx_interactions_channel_id ON interactions(channel_id);

  CREATE TABLE IF NOT EXISTS listings (
    interaction_id TEXT PRIMARY KEY REFERENCES interactions(interaction_id),
    item TEXT NOT NULL,
    condition TEXT NOT NULL DEFAULT 'used',
    target_price REAL NOT NULL,
    floor_price REAL NOT NULL,
    deadline TEXT NOT NULL,
    listing_status TEXT NOT NULL DEFAULT 'negotiating',
    accepted_offer REAL,
    drop_proposed INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS offers (
    offer_id TEXT PRIMARY KEY,
    interaction_id TEXT NOT NULL REFERENCES listings(interaction_id),
    received_at TEXT NOT NULL,
    amount REAL NOT NULL,
    raw_text TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT 'pending'
  );
`);

class MockConvoProvider {
  mode = 'mock';

  async createPrivateChannel(interactionId) {
    return { channelId: `chan_${uuidv4()}`, providerRef: `mock:${interactionId}` };
  }

  async createInvite(channelId, interactionId) {
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MIN * 60 * 1000).toISOString();
    const inviteLink = `${PUBLIC_BASE_URL}/join/${token}?interactionId=${interactionId}&channelId=${channelId}`;
    return { inviteLink, expiresAt };
  }

  async sendMessage(channelId, text) {
    console.log(`[mock-send] channel=${channelId} text=${text}`);
  }

  validateWebhookSignature() {
    return true;
  }
}

class HttpConvoProvider {
  mode = 'http';

  constructor() {
    this.apiBase = process.env.CONVO_API_BASE;
    this.apiKey = process.env.CONVO_API_KEY;
    this.webhookSecret = process.env.CONVO_WEBHOOK_SECRET || '';
  }

  async createPrivateChannel(interactionId) {
    const response = await fetch(`${this.apiBase}/channels/private`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ interactionId })
    });
    if (!response.ok) throw new Error(`createPrivateChannel failed (${response.status})`);
    const json = await response.json();
    return { channelId: json.channelId, providerRef: json.providerRef || null };
  }

  async createInvite(channelId) {
    const response = await fetch(`${this.apiBase}/channels/${encodeURIComponent(channelId)}/invite`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ ttlMinutes: INVITE_TTL_MIN })
    });
    if (!response.ok) throw new Error(`createInvite failed (${response.status})`);
    const json = await response.json();
    return { inviteLink: json.inviteLink, expiresAt: json.expiresAt };
  }

  async sendMessage(channelId, text) {
    const response = await fetch(`${this.apiBase}/channels/${encodeURIComponent(channelId)}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({ text })
    });
    if (!response.ok) throw new Error(`sendMessage failed (${response.status})`);
  }

  validateWebhookSignature(signature) {
    if (!this.webhookSecret) return true;
    return signature === this.webhookSecret;
  }
}

function buildProvider() {
  const hasRealConfig = process.env.CONVO_API_BASE && process.env.CONVO_API_KEY;
  return hasRealConfig ? new HttpConvoProvider() : new MockConvoProvider();
}

const provider = buildProvider();

function createInteractionRecord(record) {
  const insert = db.prepare(`
    INSERT INTO interactions (
      interaction_id, created_at, status, channel_id, invite_link, expires_at, closed_at, provider_mode, participants_json
    ) VALUES (
      @interactionId, @createdAt, @status, @channelId, @inviteLink, @expiresAt, @closedAt, @providerMode, @participantsJson
    )
  `);
  insert.run(record);
}

function getInteractionById(interactionId) {
  const row = db.prepare('SELECT * FROM interactions WHERE interaction_id = ?').get(interactionId);
  return row ? hydrateInteraction(row) : null;
}

function getInteractionByChannelId(channelId) {
  const row = db.prepare('SELECT * FROM interactions WHERE channel_id = ?').get(channelId);
  return row ? hydrateInteraction(row) : null;
}

function hydrateInteraction(row) {
  return {
    interactionId: row.interaction_id,
    createdAt: row.created_at,
    status: row.status,
    channelId: row.channel_id,
    inviteLink: row.invite_link,
    expiresAt: row.expires_at,
    closedAt: row.closed_at,
    providerMode: row.provider_mode,
    participants: JSON.parse(row.participants_json || '[]')
  };
}

function updateInteraction(interaction) {
  db.prepare(`
    UPDATE interactions
    SET status = @status,
        invite_link = @inviteLink,
        expires_at = @expiresAt,
        closed_at = @closedAt,
        participants_json = @participantsJson
    WHERE interaction_id = @interactionId
  `).run({
    interactionId: interaction.interactionId,
    status: interaction.status,
    inviteLink: interaction.inviteLink,
    expiresAt: interaction.expiresAt,
    closedAt: interaction.closedAt || null,
    participantsJson: JSON.stringify(interaction.participants || [])
  });
}

// ── Listing helpers ──────────────────────────────────────────────────────────

function createListing(listing) {
  db.prepare(`
    INSERT INTO listings (interaction_id, item, condition, target_price, floor_price, deadline, listing_status)
    VALUES (@interactionId, @item, @condition, @targetPrice, @floorPrice, @deadline, 'negotiating')
  `).run(listing);
}

function getListingByInteractionId(interactionId) {
  return db.prepare('SELECT * FROM listings WHERE interaction_id = ?').get(interactionId) || null;
}

function updateListing(listing) {
  db.prepare(`
    UPDATE listings
    SET listing_status = @listingStatus,
        target_price   = @targetPrice,
        accepted_offer = @acceptedOffer,
        drop_proposed  = @dropProposed
    WHERE interaction_id = @interactionId
  `).run({
    interactionId: listing.interaction_id,
    listingStatus: listing.listing_status,
    targetPrice:   listing.target_price,
    acceptedOffer: listing.accepted_offer || null,
    dropProposed:  listing.drop_proposed ? 1 : 0
  });
}

// ── Offer helpers ─────────────────────────────────────────────────────────────

function createOffer(offer) {
  db.prepare(`
    INSERT INTO offers (offer_id, interaction_id, received_at, amount, raw_text, outcome)
    VALUES (@offerId, @interactionId, @receivedAt, @amount, @rawText, @outcome)
  `).run(offer);
}

function updateOfferOutcome(offerId, outcome) {
  db.prepare('UPDATE offers SET outcome = ? WHERE offer_id = ?').run(outcome, offerId);
}

// ── Price extraction ──────────────────────────────────────────────────────────

function extractPrice(text) {
  const m = text.match(/\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/);
  if (m) return parseFloat(m[1].replace(/,/g, ''));
  const m2 = text.match(/([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:dollars?|bucks?|usd)/i);
  if (m2) return parseFloat(m2[1].replace(/,/g, ''));
  return null;
}

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, host: HOST, port: PORT, publicBaseUrl: PUBLIC_BASE_URL, providerMode: provider.mode });
});

app.post('/api/v1/interactions/sell', async (req, res) => {
  try {
    const { item, condition = 'used', targetPrice, floorPrice, deadline, source } = req.body || {};

    if (!item)        return res.status(400).json({ error: 'item is required' });
    if (!targetPrice) return res.status(400).json({ error: 'targetPrice is required' });
    if (!floorPrice)  return res.status(400).json({ error: 'floorPrice is required' });
    if (!deadline)    return res.status(400).json({ error: 'deadline is required' });

    const deadlineDate = new Date(deadline);
    if (isNaN(deadlineDate.getTime()) || deadlineDate <= new Date()) {
      return res.status(400).json({ error: 'deadline must be a valid future timestamp' });
    }

    const interactionId = `int_${uuidv4()}`;
    const createdAt = new Date().toISOString();

    const channel = await provider.createPrivateChannel(interactionId);
    const invite = await provider.createInvite(channel.channelId, interactionId);
    const qrDataUrl = await QRCode.toDataURL(invite.inviteLink, { width: 320, margin: 1 });

    const interaction = {
      interactionId,
      createdAt,
      status: 'qr_issued',
      channelId: channel.channelId,
      inviteLink: invite.inviteLink,
      expiresAt: invite.expiresAt,
      closedAt: null,
      providerMode: provider.mode,
      participants: []
    };

    createInteractionRecord({ ...interaction, participantsJson: JSON.stringify(interaction.participants) });
    createListing({ interactionId, item, condition, targetPrice: Number(targetPrice), floorPrice: Number(floorPrice), deadline: deadlineDate.toISOString() });

    res.status(201).json({ ...interaction, qrDataUrl, listing: { item, condition, targetPrice, floorPrice, deadline: deadlineDate.toISOString() } });
  } catch (error) {
    console.error('create interaction error', error);
    res.status(503).json({ error: 'Failed to create interaction', detail: String(error.message || error) });
  }
});

app.post('/api/v1/webhooks/convo/join', (req, res) => {
  const signature = req.header('x-signature') || '';
  if (!provider.validateWebhookSignature(signature)) return res.status(401).json({ error: 'Invalid signature' });

  const { channelId, participant } = req.body || {};
  const interaction = getInteractionByChannelId(channelId);
  if (!interaction) return res.status(404).json({ error: 'Unknown channel' });

  interaction.status = 'active';
  if (participant) interaction.participants = [...interaction.participants, participant];
  updateInteraction(interaction);

  return res.json({ ok: true, interactionId: interaction.interactionId, status: interaction.status });
});

app.post('/api/v1/webhooks/convo/message', async (req, res) => {
  const signature = req.header('x-signature') || '';
  if (!provider.validateWebhookSignature(signature)) return res.status(401).json({ error: 'Invalid signature' });

  const { channelId, text } = req.body || {};
  const interaction = getInteractionByChannelId(channelId);
  if (!interaction) return res.status(404).json({ error: 'Unknown channel' });
  if (interaction.status === 'closed' || interaction.status === 'expired') {
    return res.status(410).json({ error: 'Interaction inactive' });
  }

  const listing = getListingByInteractionId(interaction.interactionId);
  if (!listing || listing.listing_status !== 'negotiating') {
    console.log('[inbound-message] no active listing', { interactionId: interaction.interactionId, text });
    return res.json({ ok: true, interactionId: interaction.interactionId });
  }

  const offerAmount = extractPrice(text || '');
  console.log('[inbound-message]', { interactionId: interaction.interactionId, channelId, text, offerAmount });

  if (offerAmount !== null) {
    const offerId = `off_${uuidv4()}`;
    const autoRejectFloor = listing.floor_price * 0.85;

    if (offerAmount < autoRejectFloor) {
      // Auto-reject: too far below floor
      createOffer({ offerId, interactionId: interaction.interactionId, receivedAt: new Date().toISOString(), amount: offerAmount, rawText: text, outcome: 'auto_rejected' });
      await provider.sendMessage(channelId,
        `Thanks for the offer. $${offerAmount} is below what we can accept. Our asking price is $${listing.target_price}. Feel free to make a higher offer.`
      );
      return res.json({ ok: true, action: 'auto_rejected', offerId, amount: offerAmount });
    }

    if (offerAmount >= listing.target_price) {
      // At or above target — surface to seller for final approval
      createOffer({ offerId, interactionId: interaction.interactionId, receivedAt: new Date().toISOString(), amount: offerAmount, rawText: text, outcome: 'pending_approval' });
      await provider.sendMessage(channelId,
        `Great offer! I'll confirm with the seller and get back to you shortly.`
      );
      console.log(`[APPROVAL REQUIRED] interactionId=${interaction.interactionId} offerId=${offerId} amount=$${offerAmount} — seller must approve via POST /api/v1/offers/${offerId}/approve`);
      return res.json({ ok: true, action: 'pending_approval', offerId, amount: offerAmount });
    }

    // Between floor*0.85 and targetPrice — counter-offer
    createOffer({ offerId, interactionId: interaction.interactionId, receivedAt: new Date().toISOString(), amount: offerAmount, rawText: text, outcome: 'countered' });
    const counter = ((offerAmount + listing.target_price) / 2).toFixed(2);
    await provider.sendMessage(channelId,
      `Thanks for the offer of $${offerAmount}. We can meet in the middle at $${counter}. Does that work for you?`
    );
    return res.json({ ok: true, action: 'countered', offerId, amount: offerAmount, counter: Number(counter) });
  }

  // No price found — just log it
  return res.json({ ok: true, interactionId: interaction.interactionId });
});

app.post('/api/v1/offers/:offerId/approve', async (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE offer_id = ?').get(req.params.offerId);
  if (!offer) return res.status(404).json({ error: 'Unknown offer' });
  if (offer.outcome !== 'pending_approval') return res.status(409).json({ error: `Offer is already ${offer.outcome}` });

  const listing = getListingByInteractionId(offer.interaction_id);
  const interaction = getInteractionById(offer.interaction_id);
  if (!listing || !interaction) return res.status(404).json({ error: 'Listing or interaction not found' });

  updateOfferOutcome(offer.offer_id, 'accepted');
  listing.listing_status = 'accepted';
  listing.accepted_offer = offer.amount;
  updateListing(listing);

  await provider.sendMessage(interaction.channelId,
    `Great news! The seller has accepted your offer of $${offer.amount}. Please reply to arrange pickup/meetup. For safety, we suggest meeting at a police station parking lot or another busy public location.`
  );

  return res.json({ ok: true, offerId: offer.offer_id, amount: offer.amount, interactionId: offer.interaction_id });
});

app.post('/api/v1/offers/:offerId/reject', async (req, res) => {
  const offer = db.prepare('SELECT * FROM offers WHERE offer_id = ?').get(req.params.offerId);
  if (!offer) return res.status(404).json({ error: 'Unknown offer' });
  if (offer.outcome !== 'pending_approval') return res.status(409).json({ error: `Offer is already ${offer.outcome}` });

  const interaction = getInteractionById(offer.interaction_id);
  if (!interaction) return res.status(404).json({ error: 'Interaction not found' });

  updateOfferOutcome(offer.offer_id, 'rejected');
  await provider.sendMessage(interaction.channelId,
    `Sorry, we're unable to accept that offer. Feel free to send another offer closer to our asking price of $${db.prepare('SELECT target_price FROM listings WHERE interaction_id = ?').get(offer.interaction_id)?.target_price}.`
  );

  return res.json({ ok: true, offerId: offer.offer_id });
});

app.post('/api/v1/interactions/:id/close', (req, res) => {
  const interaction = getInteractionById(req.params.id);
  if (!interaction) return res.status(404).json({ error: 'Unknown interaction' });

  interaction.status = 'closed';
  interaction.closedAt = new Date().toISOString();
  updateInteraction(interaction);

  return res.json({ interactionId: interaction.interactionId, status: interaction.status, closedAt: interaction.closedAt });
});

app.get('/api/v1/interactions/:id', (req, res) => {
  const interaction = getInteractionById(req.params.id);
  if (!interaction) return res.status(404).json({ error: 'Unknown interaction' });
  return res.json(interaction);
});

// ── Deadline price-drop scheduler ────────────────────────────────────────────
// Every 60 s: check listings whose deadline is within 4 h and no accepted offer.
// If not yet proposed, drop target by 10% and notify the buyer channel.

const DEADLINE_CHECK_INTERVAL_MS = 60_000;
const DEADLINE_WARN_HORIZON_MS   = 4 * 60 * 60 * 1000; // 4 hours

setInterval(async () => {
  const now = Date.now();
  const horizon = new Date(now + DEADLINE_WARN_HORIZON_MS).toISOString();

  const urgentListings = db.prepare(`
    SELECT l.*, i.channel_id
    FROM listings l
    JOIN interactions i ON i.interaction_id = l.interaction_id
    WHERE l.listing_status = 'negotiating'
      AND l.deadline <= ?
      AND l.drop_proposed = 0
  `).all(horizon);

  for (const listing of urgentListings) {
    const newTarget = Math.round(listing.target_price * 0.9 * 100) / 100;
    db.prepare(`UPDATE listings SET target_price = ?, drop_proposed = 1 WHERE interaction_id = ?`)
      .run(newTarget, listing.interaction_id);

    await provider.sendMessage(listing.channel_id,
      `⏰ Deadline approaching! We've reduced the price to $${newTarget}. This offer expires at ${new Date(listing.deadline).toLocaleString()}.`
    ).catch(err => console.error('[deadline-drop] sendMessage failed', err));

    console.log(`[deadline-drop] interactionId=${listing.interaction_id} newTarget=$${newTarget}`);
  }
}, DEADLINE_CHECK_INTERVAL_MS);

app.listen(PORT, HOST, () => {
  console.log(`sell-my-stuff-site running at ${PUBLIC_BASE_URL} (bind ${HOST}:${PORT}, provider=${provider.mode})`);
});
