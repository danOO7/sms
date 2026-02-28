const sellBtn = document.getElementById('sellBtn');
const resetBtn = document.getElementById('resetBtn');
const qrPanel = document.getElementById('qrPanel');
const qrImage = document.getElementById('qrImage');
const statusEl = document.getElementById('status');
const intakeForm = document.getElementById('intakeForm');

const interactionIdEl = document.getElementById('interactionId');
const channelIdEl = document.getElementById('channelId');
const expiresAtEl = document.getElementById('expiresAt');

lucide.createIcons();

// Pre-fill deadline to 48 h from now
const defaultDeadline = new Date(Date.now() + 48 * 60 * 60 * 1000);
document.getElementById('deadline').value = defaultDeadline.toISOString().slice(0, 16);

async function createInteraction(e) {
  e.preventDefault();
  statusEl.textContent = 'Creating private interaction...';
  sellBtn.disabled = true;

  const item        = document.getElementById('itemName').value.trim();
  const condition   = document.getElementById('condition').value;
  const targetPrice = parseFloat(document.getElementById('targetPrice').value);
  const floorPrice  = parseFloat(document.getElementById('floorPrice').value);
  const deadline    = new Date(document.getElementById('deadline').value).toISOString();

  if (floorPrice > targetPrice) {
    statusEl.textContent = 'Error: minimum price cannot exceed asking price.';
    sellBtn.disabled = false;
    return;
  }

  try {
    const response = await fetch('/api/v1/interactions/sell', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ item, condition, targetPrice, floorPrice, deadline, source: 'web' })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create interaction');
    }
    const data = await response.json();

    qrImage.src = data.qrDataUrl;
    interactionIdEl.textContent = data.interactionId;
    channelIdEl.textContent = data.channelId;
    expiresAtEl.textContent = new Date(data.expiresAt).toLocaleString();

    qrPanel.hidden = false;
    resetBtn.hidden = false;
    intakeForm.hidden = true;
    sellBtn.hidden = true;
    statusEl.textContent = `QR ready. Buyer can scan and continue privately. AutoSeller is watching for offers on "${item}".`;
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    sellBtn.disabled = false;
  }
}

intakeForm.addEventListener('submit', createInteraction);

resetBtn.addEventListener('click', () => {
  qrPanel.hidden = true;
  intakeForm.hidden = false;
  sellBtn.hidden = false;
  qrImage.src = '';
  statusEl.textContent = 'Ready for a fresh private interaction.';
});
