const express = require('express');
const fs = require('fs');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------------------------------------------------------
// JSON DATABASE
// -------------------------------------------------------
const DB_PATH = "./appointments.json";

function loadDB() {
  if (!fs.existsSync(DB_PATH)) return [];
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function saveDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function findAppointment(phone) {
  const db = loadDB();
  return db.find(a => a.phone === phone);
}

function addAppointment(name, phone, date, time) {
  const db = loadDB();
  db.push({ name, phone, date, time });
  saveDB(db);
}

function deleteAppointment(phone) {
  let db = loadDB();
  db = db.filter(a => a.phone !== phone);
  saveDB(db);
}

// -------------------------------------------------------
// MAIN MENU
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 5
  });

  gather.say(
    "Thank you for choosing Altair Partners. " +
    "Press 1 to cancel or schedule an appointment. " +
    "Press 3 to speak with a representative. " +
    "Press 9 to request a callback."
  );

  // If no input, repeat menu
  twiml.redirect('/voice');

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// HANDLE MAIN MENU
// -------------------------------------------------------
app.post('/handle-key', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  if (digit === '1') {
    const appt = findAppointment(phone);

    if (appt) {
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 5
      });

      gather.say(
        `You have an appointment on ${appt.date} at ${appt.time}. ` +
        "Press 1 to cancel or 2 to reschedule."
      );

      // If no input, go back
      twiml.redirect('/voice');

    } else {
      twiml.redirect(`/start-appointment?phone=${encodeURIComponent(phone)}`);
    }
  }

  else if (digit === '3') {
    twiml.redirect('/rep-busy');
  }

  else if (digit === '9') {
    twiml.redirect('/callback-request');
  }

  else {
    twiml.say("Invalid option. Try again.");
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CANCEL / RESCHEDULE
// -------------------------------------------------------
app.post('/appointment-manage', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.query.phone;

  if (digit === '1') {
    deleteAppointment(phone);
    twiml.say("Your appointment has been cancelled.");
    twiml.pause(1);
    twiml.say("Goodbye.");
    twiml.hangup();
  }

  else if (digit === '2') {
    deleteAppointment(phone);
    twiml.say("Let's reschedule.");
    twiml.redirect(`/start-appointment?phone=${encodeURIComponent(phone)}`);
  }

  else {
    twiml.say("Invalid option.");
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// NAME
// -------------------------------------------------------
app.post('/start-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;

  const gather = twiml.gather({
    input: "speech",
    action: `/book-date?phone=${phone}`,
    method: "POST",
    speechTimeout: 3,
    timeout: 10
  });

  gather.say("Please say your full name.");

  // If no speech detected
  twiml.say("I didn't hear your name. Let's try again.");
  twiml.redirect(`/start-appointment?phone=${phone}`);

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// DATE - FIXED!
// -------------------------------------------------------
app.post('/book-date', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;

  console.log("DEBUG - Name received:", name); // For debugging

  // Check if we got the name
  if (!name || name.trim() === '') {
    twiml.say("Sorry, I didn't catch your name.");
    twiml.redirect(`/start-appointment?phone=${phone}`);
    return res.type('text/xml').send(twiml.toString());
  }

  // Encode name for URL
  const encodedName = encodeURIComponent(name);

  const gather = twiml.gather({
    input: "speech",
    action: `/book-time?phone=${phone}&name=${encodedName}`,
    method: "POST",
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });

  gather.say(`Thanks. What day works for you? For example, you can say Friday, or a specific date like December 15th.`);

  // If no speech detected
  twiml.say("I didn't hear a date.");
  twiml.redirect(`/book-date?phone=${phone}`);

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// TIME - FIXED!
// -------------------------------------------------------
app.post('/book-time', (req, res) => {
  const twiml = new VoiceResponse();
  const date = req.body.SpeechResult || '';
  const name = decodeURIComponent(req.query.name || '');
  const phone = req.query.phone || req.body.From;

  console.log("DEBUG - Date received:", date); // For debugging

  // Check if we got the date
  if (!date || date.trim() === '') {
    twiml.say("Sorry, I didn't catch the date.");
    twiml.redirect(`/book-date?phone=${phone}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }

  // Encode date
  const encodedDate = encodeURIComponent(date);

  const gather = twiml.gather({
    input: "speech",
    action: `/confirm-booking?phone=${phone}&name=${encodeURIComponent(name)}&date=${encodedDate}`,
    method: "POST",
    speechTimeout: 3,
    timeout: 10
  });

  gather.say(`What time on ${date}? For example, you can say 2 PM, or 10 in the morning.`);

  // If no speech detected
  twiml.say("I didn't hear a time.");
  twiml.redirect(`/book-time?phone=${phone}&name=${encodeURIComponent(name)}`);

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// SAVE APPOINTMENT - FIXED!
// -------------------------------------------------------
app.post('/confirm-booking', (req, res) => {
  const twiml = new VoiceResponse();
  const time = req.body.SpeechResult || '';
  const name = decodeURIComponent(req.query.name || '');
  const date = decodeURIComponent(req.query.date || '');
  const phone = req.query.phone || req.body.From;

  console.log("DEBUG - Time received:", time); // For debugging

  // Check all data
  if (!time || !name || !date || !phone) {
    twiml.say("Sorry, there was an error. Let's start over.");
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  // Add appointment
  addAppointment(name, phone, date, time);

  // Send SMS confirmation
  try {
    twilioClient.messages.create({
      body: `✅ New appointment: ${name} - ${date} at ${time} (from: ${phone})`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.MY_PERSONAL_NUMBER
    });
  } catch (err) {
    console.log("SMS error:", err);
  }

  twiml.say(`Perfect! Your appointment has been scheduled for ${date} at ${time}. Thank you!`);
  twiml.pause(1);
  twiml.say("Goodbye.");
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CALLBACK REQUEST
// -------------------------------------------------------
app.post('/callback-request', (req, res) => {
  const twiml = new VoiceResponse();
  const caller = req.body.From;

  twiml.say("Your callback request has been submitted. We'll call you back as soon as possible.");

  // Send SMS
  twilioClient.messages.create({
    body: `📞 Callback requested from ${caller}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  twiml.pause(1);
  twiml.say("Goodbye.");
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// VOICEMAIL
// -------------------------------------------------------
app.post('/rep-busy', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say("All representatives are currently busy. Please leave a message after the beep.");

  twiml.record({
    action: '/voicemail-complete',
    maxLength: 120,
    playBeep: true,
    timeout: 10
  });

  // If no recording
  twiml.say("No message recorded. Goodbye.");
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/voicemail-complete', (req, res) => {
  const twiml = new VoiceResponse();
  const url = req.body.RecordingUrl;
  const caller = req.body.From;

  // Send SMS with voicemail link
  twilioClient.messages.create({
    body: `📩 New voicemail from ${caller}: ${url}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  twiml.say("Thank you for your message. We'll get back to you as soon as possible. Goodbye.");
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).send('IVR Server is running');
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
const PORT = process.env.PORT || 1337;
app.listen(PORT, () => console.log(`✅ IVR server running on port ${PORT}`));