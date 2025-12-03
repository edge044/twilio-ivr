const express = require('express');
const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();

// Middleware so Twilio can send form data
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// MAIN IVR MENU
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST'
  });

  gather.say(
    "Welcome to your creative agency. Press 1 to book an appointment. Press 2 for business information. Press 3 to talk to your AI assistant."
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

// HANDLE MENU INPUT
app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;

  if (digit === '1') {
    twiml.say("Booking an appointment. Please wait while I connect you.");
  } else if (digit === '2') {
    twiml.say("Business information goes here.");
  } else if (digit === '3') {
    twiml.say("Connecting you to your AI assistant.");
  } else {
    twiml.say("Invalid choice. Goodbye.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// START SERVER
app.listen(1337, () => {
  console.log('IVR server running at http://127.0.0.1:1337/');
});

