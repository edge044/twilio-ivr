const express = require('express');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------------------------------------------------------
// MAIN IVR MENU (ALTAIR PARTNERS)
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST'
  });

  gather.say(
    "Thank you for choosing Altair Partners. Your call may be monitored for quality assurance. Press 1 to cancel or schedule an appointment. Press 3 to speak with one of our representatives. Press 9 if you would like a callback."
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// MENU HANDLER
// -------------------------------------------------------
app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;

  if (digit === '1') {
    twiml.redirect('/book-date');

  } else if (digit === '3') {
    // Fake connecting message
    twiml.say("Please wait while I connect you with one of our representatives.");
    twiml.redirect('/rep-busy');

  } else if (digit === '9') {
    twiml.redirect('/callback-request');

  } else {
    twiml.say("Invalid choice. Goodbye.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CALLBACK REQUEST
// -------------------------------------------------------
app.post('/callback-request', (req, res) => {
  const twiml = new VoiceResponse();
  const caller = req.body.From;

  twiml.say("Thank you. Your callback request has been submitted. Goodbye.");

  // Send SMS to you
  twilioClient.messages.create({
    body: `📞 Callback Requested:\nCaller: ${caller}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// REPRESENTATIVE BUSY → VOICEMAIL
// -------------------------------------------------------
app.post('/rep-busy', (req, res) => {
  const twiml = new VoiceResponse();

  twiml.pause({ length: 2 });

  twiml.say("I'm sorry, all of our representatives are busy right now. Please leave a message after the beep. Press the pound key when you are finished.");

  twiml.record({
    action: '/voicemail-complete',
    method: 'POST',
    maxLength: 60,
    playBeep: true,
    finishOnKey: '#'
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// VOICEMAIL COMPLETE → SEND SMS
// -------------------------------------------------------
app.post('/voicemail-complete', (req, res) => {
  const twiml = new VoiceResponse();
  const recordingUrl = req.body.RecordingUrl;

  twiml.say("Thank you. Your message has been recorded. Goodbye.");

  twilioClient.messages.create({
    body: `📩 New Voicemail Received:\n${recordingUrl}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// APPOINTMENT BOOKING FLOW
// -------------------------------------------------------
app.post('/book-date', (req, res) => {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    input: "speech",
    action: "/book-time",
    method: "POST"
  });

  gather.say("Sure, what day would you like to book your appointment? You can say tomorrow, Friday, or December ninth.");

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/book-time', (req, res) => {
  const twiml = new VoiceResponse();
  const date = req.body.SpeechResult || "an unspecified date";

  const gather = twiml.gather({
    input: "speech",
    action: `/confirm-booking?date=${encodeURIComponent(date)}`,
    method: "POST"
  });

  gather.say(`Got it. You said ${date}. What time works best for you?`);

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/confirm-booking', (req, res) => {
  const twiml = new VoiceResponse();
  const date = req.query.date || "an unspecified day";
  const time = req.body.SpeechResult || "an unspecified time";

  twiml.say(`Great! I have you down for ${date} at ${time}. We will contact you soon to confirm. Thank you!`);

  twilioClient.messages.create({
    body: `New Appointment Booked:\nDate: ${date}\nTime: ${time}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
app.listen(1337, () => {
  console.log('IVR server running at http://127.0.0.1:1337/');
});
