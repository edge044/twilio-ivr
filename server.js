const express = require('express');
const app = express();

// Простой корневой эндпоинт
app.get('/', (req, res) => {
  res.send('✅ Altair IVR is WORKING!');
});

// Twilio webhook
app.post('/voice', (req, res) => {
  const twiml = `<Response><Say>Test IVR is working!</Say></Response>`;
  res.type('text/xml');
  res.send(twiml);
});

const PORT = process.env.PORT || 1337;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});