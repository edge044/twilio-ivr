const express = require('express');
const VoiceResponse = require('twilio').twiml.VoiceResponse;

const app = express();

// Create a route that will handle Twilio webhook requests,
// sent as an HTTP POST to /voice in our application
app.post('/voice', (request, response) => {
  const twiml = new VoiceResponse();

  twiml.say('Hello! Your AI phone line is working. I will become smarter soon.');

  response.type('text/xml');
  response.send(twiml.toString());
});

// Start the server on port 1337
app.listen(1337, () => {
  console.log('TwiML server running at http://127.0.0.1:1337/');
});

