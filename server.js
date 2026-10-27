const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'messages.json');

// In-memory messages + SSE clients
let messages = [];
let clients = [];

// Load existing messages
if (fs.existsSync(DATA_FILE)) {
  try { messages = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch(e) { messages = []; }
}

function saveMessages() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(messages, null, 2));
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE endpoint for real-time updates
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('\n');
  clients.push(res);
  req.on('close', () => { clients = clients.filter(c => c !== res); });
});

function broadcast(event, data) {
  clients.forEach(c => {
    c.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  });
}

// Get all messages
app.get('/api/messages', (req, res) => {
  res.json(messages);
});

// Post a new message
app.post('/api/messages', (req, res) => {
  const { name, text, topic } = req.body;
  if (!text || !text.trim()) return res.status(400).json({ error: 'Message required' });

  const msg = {
    id: crypto.randomUUID(),
    name: (name || 'Anonymous').trim().slice(0, 60),
    text: text.trim().slice(0, 1000),
    topic: (topic || 'General').trim().slice(0, 100),
    timestamp: Date.now(),
    upvotes: 0,
    upvoters: [],
  };
  messages.push(msg);
  saveMessages();
  broadcast('new-message', msg);
  res.status(201).json(msg);
});

// Upvote a message
app.post('/api/messages/:id/upvote', (req, res) => {
  const { voterId } = req.body;
  const msg = messages.find(m => m.id === req.params.id);
  if (!msg) return res.status(404).json({ error: 'Not found' });

  if (voterId && msg.upvoters.includes(voterId)) {
    // Remove upvote
    msg.upvoters = msg.upvoters.filter(v => v !== voterId);
    msg.upvotes = msg.upvoters.length;
  } else if (voterId) {
    msg.upvoters.push(voterId);
    msg.upvotes = msg.upvoters.length;
  }
  saveMessages();
  broadcast('upvote', { id: msg.id, upvotes: msg.upvotes, upvoters: msg.upvoters });
  res.json(msg);
});

// Admin: delete a message (requires ADMIN_KEY env var)
app.delete('/api/messages/:id', (req, res) => {
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) return res.status(403).json({ error: 'ADMIN_KEY not configured' });

  const provided = req.headers['x-admin-key'];
  if (provided !== adminKey) return res.status(401).json({ error: 'Invalid admin key' });

  const idx = messages.findIndex(m => m.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  messages.splice(idx, 1);
  saveMessages();
  broadcast('delete', { id: req.params.id });
  res.json({ deleted: req.params.id });
});

app.listen(PORT, () => {
  console.log(`\n  Save TSP Community Voice Board is live at:\n  http://localhost:${PORT}\n`);
});
