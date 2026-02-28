const sellBtn = document.getElementById('sellBtn');
const resetBtn = document.getElementById('resetBtn');
const qrPanel = document.getElementById('qrPanel');
const qrImage = document.getElementById('qrImage');
const statusEl = document.getElementById('status');

const interactionIdEl = document.getElementById('interactionId');
const channelIdEl = document.getElementById('channelId');
const expiresAtEl = document.getElementById('expiresAt');

lucide.createIcons();

async function createInteraction() {
  statusEl.textContent = 'Creating private interaction...';
  sellBtn.disabled = true;

  try {
    const response = await fetch('/api/v1/interactions/sell', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'web' })
    });

    if (!response.ok) throw new Error('Failed to create interaction');
    const data = await response.json();

    qrImage.src = data.qrDataUrl;
    interactionIdEl.textContent = data.interactionId;
    channelIdEl.textContent = data.channelId;
    expiresAtEl.textContent = new Date(data.expiresAt).toLocaleString();

    qrPanel.hidden = false;
    resetBtn.hidden = false;
    statusEl.textContent = 'QR ready. User can now scan and continue privately in Convo.';
  } catch (err) {
    statusEl.textContent = 'Error: could not create interaction. Try again.';
  } finally {
    sellBtn.disabled = false;
  }
}

sellBtn.addEventListener('click', createInteraction);
resetBtn.addEventListener('click', () => {
  qrPanel.hidden = true;
  qrImage.src = '';
  statusEl.textContent = 'Ready for a fresh private interaction.';
});
