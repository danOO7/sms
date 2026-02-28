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
const FIRST_PROMPT = [
  'Quick start — reply in one message using this format:',
  '1) Item + condition',
  '2) Sell-by date (YYYY-MM-DD)',
  '3) Minimum price (USD)',
  '4) Preferred meetup area (private, not for listing)',
  '5) Weekday + weekend availability in the next 2 weeks',
  '6) Ad tone: funny, serious, simple, or urgent'
].join('\n');

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
    participants_json TEXT NOT NULL DEFAULT '[]',
    seller_profile_json TEXT NOT NULL DEFAULT '{}'
  );

  CREATE INDEX IF NOT EXISTS idx_interactions_channel_id ON interactions(channel_id);
`);

function ensureColumn(tableName, columnName, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all();
  const exists = cols.some((c) => c.name === columnName);
  if (!exists) db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${ddl}`);
}

ensureColumn('interactions', 'seller_profile_json', "seller_profile_json TEXT NOT NULL DEFAULT '{}'");

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
    console.log('[mock-outbound-message]', { channelId, text });
    return { ok: true };
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
    return response.json();
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
      interaction_id, created_at, status, channel_id, invite_link, expires_at, closed_at, provider_mode, participants_json, seller_profile_json
    ) VALUES (
      @interactionId, @createdAt, @status, @channelId, @inviteLink, @expiresAt, @closedAt, @providerMode, @participantsJson, @sellerProfileJson
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
    participants: JSON.parse(row.participants_json || '[]'),
    sellerProfile: JSON.parse(row.seller_profile_json || '{}')
  };
}

function updateInteraction(interaction) {
  db.prepare(`
    UPDATE interactions
    SET status = @status,
        invite_link = @inviteLink,
        expires_at = @expiresAt,
        closed_at = @closedAt,
        participants_json = @participantsJson,
        seller_profile_json = @sellerProfileJson
    WHERE interaction_id = @interactionId
  `).run({
    interactionId: interaction.interactionId,
    status: interaction.status,
    inviteLink: interaction.inviteLink,
    expiresAt: interaction.expiresAt,
    closedAt: interaction.closedAt || null,
    participantsJson: JSON.stringify(interaction.participants || []),
    sellerProfileJson: JSON.stringify(interaction.sellerProfile || {})
  });
}

function mergeSellerProfileFromText(existingProfile, text) {
  const profile = { ...existingProfile };
  const lines = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const cleaned = line.replace(/^\d+[\).:-]?\s*/, '');
    const lower = cleaned.toLowerCase();

    if (lower.includes('sell-by') || lower.includes('sell by') || lower.includes('deadline')) {
      const match = cleaned.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) profile.sellByDate = match[1];
    } else if (lower.includes('minimum') || lower.startsWith('min ')) {
      const match = cleaned.match(/\$?\s*(\d+(?:\.\d{1,2})?)/);
      if (match) profile.minimumPrice = Number(match[1]);
    } else if (lower.includes('meet') || lower.includes('pickup') || lower.includes('location') || lower.includes('area')) {
      profile.meetupArea = cleaned;
    } else if (lower.includes('weekday') || lower.includes('weekend') || lower.includes('availability') || lower.includes('time')) {
      profile.availability = cleaned;
    } else if (lower.includes('tone') || ['funny', 'serious', 'simple', 'urgent'].some((t) => lower.includes(t))) {
      const toneMatch = ['funny', 'serious', 'simple', 'urgent'].find((t) => lower.includes(t));
      profile.adTone = toneMatch || cleaned;
    } else if (!profile.itemSummary) {
      profile.itemSummary = cleaned;
    }
  }

  return profile;
}

function missingSellerFields(profile) {
  const required = ['sellByDate', 'minimumPrice', 'meetupArea', 'availability', 'adTone'];
  return required.filter((f) => profile[f] === undefined || profile[f] === null || profile[f] === '');
}

app.get('/api/v1/health', (req, res) => {
  res.json({ ok: true, host: HOST, port: PORT, publicBaseUrl: PUBLIC_BASE_URL, providerMode: provider.mode });
});

app.post('/api/v1/interactions/sell', async (req, res) => {
  try {
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
      participants: [],
      sellerProfile: {}
    };

    createInteractionRecord({
      ...interaction,
      participantsJson: JSON.stringify(interaction.participants),
      sellerProfileJson: JSON.stringify(interaction.sellerProfile)
    });

    res.status(201).json({ ...interaction, qrDataUrl });
  } catch (error) {
    console.error('create interaction error', error);
    res.status(503).json({ error: 'Failed to create interaction', detail: String(error.message || error) });
  }
});

app.post('/api/v1/webhooks/convo/join', async (req, res) => {
  const signature = req.header('x-signature') || '';
  if (!provider.validateWebhookSignature(signature)) return res.status(401).json({ error: 'Invalid signature' });

  const { channelId, participant } = req.body || {};
  const interaction = getInteractionByChannelId(channelId);
  if (!interaction) return res.status(404).json({ error: 'Unknown channel' });

  const wasActive = interaction.status === 'active';
  interaction.status = 'active';
  if (participant) interaction.participants = [...interaction.participants, participant];
  updateInteraction(interaction);

  if (!wasActive) {
    try {
      await provider.sendMessage(channelId, 'Welcome to Sell my Stuff!');
      await provider.sendMessage(channelId, FIRST_PROMPT);
    } catch (error) {
      console.error('welcome message send error', error);
    }
  }

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

  interaction.sellerProfile = mergeSellerProfileFromText(interaction.sellerProfile || {}, text);
  updateInteraction(interaction);

  const missing = missingSellerFields(interaction.sellerProfile || {});
  if (missing.length > 0) {
    const labels = {
      sellByDate: 'sell-by date (YYYY-MM-DD)',
      minimumPrice: 'minimum price (USD)',
      meetupArea: 'preferred meetup area',
      availability: 'weekday/weekend availability in next 2 weeks',
      adTone: 'ad tone (funny/serious/simple/urgent)'
    };
    const prompt = `Thanks — I saved that. Still needed: ${missing.map((k) => labels[k]).join(', ')}.`;
    try {
      await provider.sendMessage(channelId, prompt);
    } catch (error) {
      console.error('follow-up prompt send error', error);
    }
  } else {
    const summary = interaction.sellerProfile;
    const ack = [
      'Great — got everything I need to draft your listing.',
      `Sell-by date: ${summary.sellByDate}`,
      `Minimum price: $${summary.minimumPrice}`,
      `Ad tone: ${summary.adTone}`,
      'I saved your meetup area and availability privately for buyer coordination.'
    ].join('\n');
    try {
      await provider.sendMessage(channelId, ack);
    } catch (error) {
      console.error('profile-complete ack send error', error);
    }
  }

  console.log('[inbound-message]', { interactionId: interaction.interactionId, channelId, text });
  return res.json({ ok: true, interactionId: interaction.interactionId, sellerProfile: interaction.sellerProfile });
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

app.listen(PORT, HOST, () => {
  console.log(`sell-my-stuff-site running at ${PUBLIC_BASE_URL} (bind ${HOST}:${PORT}, provider=${provider.mode})`);
});
