const express = require('express');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();

// Middleware so Twilio can send form data
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------------------------------------------------------
// MAIN IVR MENU (BRANDED FOR ALTAIR PARTNERS)
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST'
  });

  gather.say(
    "Thank you for choosing Altair Partners. Your call may be monitored for quality assurance. Press 1 to cancel or schedule an appointment. Press 3 to leave a message for one of our representatives."
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// MENU INPUT HANDLER
// -------------------------------------------------------
app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;

  if (digit === '1') {
    twiml.redirect('/book-date');
  } else if (digit === '3') {
    twiml.redirect('/voicemail');
  } else {
    twiml.say("Invalid choice. Goodbye.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// VOICEMAIL ROUTE
// -------------------------------------------------------
app.post('/voicemail', (req, res) => {
  const twiml = new VoiceResponse();

  twiml.say("All of our representatives are currently assisting other callers. Please leave a message after the beep. Press the pound key when you are finished.");

  twiml.record({
    action: '/voicemail-complete',
    method: 'POST',
    maxLength: 60,
    finishOnKey: '#',
    playBeep: true
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// VOICEMAIL COMPLETION — SEND SMS WITH LINK
// -------------------------------------------------------
app.post('/voicemail-complete', (req, res) => {
  const twiml = new VoiceResponse();
  const recordingUrl = req.body.RecordingUrl;

  twiml.say("Thank you. Your message has been sent. Goodbye.");

  // Send SMS to you with voicemail URL
  twilioClient.messages.create({
    body: `📩 New Voicemail Received:\n${recordingUrl}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  })
  .then(msg => console.log("Voicemail SMS sent:", msg.sid))
  .catch(err => console.log("Voicemail SMS error:", err));

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// APPOINTMENT BOOKING FLOW
// -------------------------------------------------------

// STEP 1 — Ask for the date
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

// STEP 2 — Ask for the time
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

// STEP 3 — CONFIRM & SEND SMS
app.post('/confirm-booking', (req, res) => {
  const twiml = new VoiceResponse();
  const date = req.query.date || "an unspecified day";
  const time = req.body.SpeechResult || "an unspecified time";

  twiml.say(`Great! I have you down for ${date} at ${time}. We will contact you soon to confirm. Thank you!`);

  twilioClient.messages.create({
    body: `New Appointment Booked:\nDate: ${date}\nTime: ${time}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  })
  .then(msg => console.log("SMS sent:", msg.sid))
  .catch(err => console.log("SMS error:", err));

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
app.listen(1337, () => {
  console.log('IVR server running at http://127.0.0.1:1337/');
});
