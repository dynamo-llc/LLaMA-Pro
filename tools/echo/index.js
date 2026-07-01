const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

const DATASET_FILE = path.join(__dirname, 'dpo_dataset.jsonl');

app.post('/feedback', (req, res) => {
  const { prompt, chosen, rejected } = req.body;
  if (!prompt || !chosen || !rejected) {
    return res.status(400).json({ error: 'Missing prompt, chosen, or rejected fields.' });
  }

  const entry = {
    timestamp: new Date().toISOString(),
    prompt,
    chosen,
    rejected
  };

  try {
    fs.appendFileSync(DATASET_FILE, JSON.stringify(entry) + '\n');
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to write feedback:', err);
    res.status(500).json({ error: 'Failed to write feedback' });
  }
});

app.get('/feedback', (req, res) => {
  try {
    if (!fs.existsSync(DATASET_FILE)) {
      return res.json({ entries: [] });
    }
    const data = fs.readFileSync(DATASET_FILE, 'utf8');
    const entries = data.trim().split('\n').filter(l => l.length > 0).map(JSON.parse);
    res.json({ entries });
  } catch (err) {
    console.error('Failed to read feedback:', err);
    res.status(500).json({ error: 'Failed to read feedback' });
  }
});

app.delete('/feedback', (req, res) => {
  try {
    if (fs.existsSync(DATASET_FILE)) {
      fs.unlinkSync(DATASET_FILE);
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to clear dataset:', err);
    res.status(500).json({ error: 'Failed to clear dataset' });
  }
});

app.get('/train', (req, res) => {
  // Use Server-Sent Events (SSE) to stream simulated training progress
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  if (!fs.existsSync(DATASET_FILE)) {
    res.write(`data: ${JSON.stringify({ error: 'No dataset found for training.' })}\n\n`);
    return res.end();
  }

  const data = fs.readFileSync(DATASET_FILE, 'utf8');
  const entries = data.trim().split('\n').filter(l => l.length > 0);
  if (entries.length < 5) {
    res.write(`data: ${JSON.stringify({ error: 'Not enough data. Need at least 5 preference pairs to train.' })}\n\n`);
    return res.end();
  }

  let epoch = 1;
  const maxEpochs = 20;
  let currentLoss = 2.45;

  const interval = setInterval(() => {
    if (epoch > maxEpochs) {
      clearInterval(interval);
      res.write(`data: ${JSON.stringify({ status: 'complete', message: 'LoRA adapter successfully trained and saved.' })}\n\n`);
      res.end();
      return;
    }

    // Simulate loss decreasing
    currentLoss = currentLoss * 0.9 + (Math.random() * 0.05);
    
    res.write(`data: ${JSON.stringify({
      status: 'training',
      epoch,
      maxEpochs,
      loss: currentLoss.toFixed(4)
    })}\n\n`);

    epoch++;
  }, 400); // Send an update every 400ms
});

const PORT = 50054;
app.listen(PORT, '127.0.0.1', () => {
  console.log(`Echo Data Server listening on http://127.0.0.1:${PORT}`);
});
