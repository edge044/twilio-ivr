const express = require('express');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const nodemailer = require('nodemailer');

const app = express();

// Middleware so Twilio can send form data
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------------------------------------------------------
// EMAIL TRANSPORTER (Google Workspace SMTP)
// -------------------------------------------------------
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.SMTP_USERNAME,    // Your Workspace email
    pass: process.env.SMTP_PASSWORD     // App Password
  }
});

// -------------------------------------------------------
// MAIN IVR MENU
// -------------------------------------------------------
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

// -------------------------------------------------------
// MENU INPUT HANDLER
// -------------------------------------------------------
app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;

  if (digit === '1') {
    twiml.redirect('/book-date');

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

// STEP 3 — Confirm booking AND SEND EMAIL
app.post('/confirm-booking', (req, res) => {
  const twiml = new VoiceResponse();

  const date = req.query.date || "an unspecified day";
  const time = req.body.SpeechResult || "an unspecified time";

  // Tell caller everything is booked
  twiml.say(`Great! I have you down for ${date} at ${time}. We will contact you soon to confirm. Thank you!`);

  // Email notification
  const mailOptions = {
    from: process.env.SMTP_USERNAME,
    to: process.env.BOOKING_TO_EMAIL,
    subject: "New Appointment Booking",
    text: `New appointment booked:\n\nDate: ${date}\nTime: ${time}\n\nSent automatically from your IVR system.`
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log("EMAIL ERROR:", error);
    } else {
      console.log("EMAIL SENT:", info.response);
    }
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
