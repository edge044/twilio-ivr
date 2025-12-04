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
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, '[]');
    return [];
  }
  const data = fs.readFileSync(DB_PATH, "utf8");
  return JSON.parse(data || '[]');
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
// MAIN MENU - UPDATED PROMPTS
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("DEBUG: /voice endpoint hit");
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for choosing Altair Partners. This call may be monitored for quality assurance. " +
    "Press 1 to schedule or cancel an appointment. " +
    "Press 3 to speak with a representative. " +
    "Press 9 to request a callback.",
    { voice: 'alice', language: 'en-US' }
  );

  // If no input, repeat once
  twiml.say("Please select an option.", { voice: 'alice', language: 'en-US' });
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

  console.log("DEBUG: /handle-key - Digit:", digit, "Phone:", phone);

  if (!digit || !phone) {
    console.log("ERROR: Missing digit or phone");
    twiml.say("Invalid input. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    console.log("DEBUG: Option 1 selected");
    const appt = findAppointment(phone);

    if (appt) {
      console.log("DEBUG: Found existing appointment");
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `You have an appointment on ${appt.date} at ${appt.time}. ` +
        "Press 1 to cancel or 2 to reschedule.",
        { voice: 'alice', language: 'en-US' }
      );

      // Fallback if no input
      twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');

    } else {
      console.log("DEBUG: No existing appointment, starting new");
      twiml.say("Let's schedule a new appointment.", { voice: 'alice', language: 'en-US' });
      twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    }
  }

  else if (digit === '3') {
    console.log("DEBUG: Option 3 selected");
    twiml.redirect('/rep-busy');
  }

  else if (digit === '9') {
    console.log("DEBUG: Option 9 selected");
    twiml.redirect('/callback-request');
  }

  else {
    console.log("DEBUG: Invalid digit:", digit);
    twiml.say("Invalid option. Please try again.", { voice: 'alice', language: 'en-US' });
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

  console.log("DEBUG: /appointment-manage - Digit:", digit, "Phone:", phone);

  if (!digit) {
    twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    deleteAppointment(phone);
    console.log("DEBUG: Appointment cancelled for:", phone);
    twiml.say("Your appointment has been cancelled. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
  }

  else if (digit === '2') {
    deleteAppointment(phone);
    console.log("DEBUG: Rescheduling for:", phone);
    twiml.say("Let's reschedule your appointment.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }

  else {
    twiml.say("Invalid option. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// GET NAME
// -------------------------------------------------------
app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  console.log("DEBUG: /get-name - Phone:", phone);

  const gather = twiml.gather({
    input: 'speech',
    action: `/process-name?phone=${encodeURIComponent(phone)}`,
    method: 'POST',
    speechTimeout: 2,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("Please say your first name.", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your name. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  console.log("DEBUG: /process-name - Phone:", phone);
  console.log("DEBUG: SpeechResult:", req.body.SpeechResult);
  
  let name = req.body.SpeechResult || '';
  
  if (name && name.trim() !== '') {
    // Take only first word and capitalize
    const firstName = name.split(' ')[0];
    const cleanedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    
    console.log("DEBUG: Cleaned name:", cleanedName);
    
    twiml.say(`Thanks ${cleanedName}.`, { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(cleanedName)}`);
  } else {
    console.log("DEBUG: No name received");
    twiml.say("Sorry, I didn't catch your name. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// GET DATE - UPDATED PROMPT (DATE ONLY, NO DAYS)
// -------------------------------------------------------
app.post('/get-date', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log("DEBUG: /get-date - Phone:", phone, "Name:", name);

  const gather = twiml.gather({
    input: 'speech',
    action: `/process-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 2,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    `Please say the date you'd like to schedule. ` +
    `Say the month and day only. For example: December 5th, or January 15. ` +
    `Do not say days like Friday or Monday. Only month and day.`,
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear a date. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-date', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log("DEBUG: /process-date - Phone:", phone, "Name:", name);
  console.log("DEBUG: SpeechResult:", req.body.SpeechResult);
  
  let date = req.body.SpeechResult || '';
  
  if (date && date.trim() !== '') {
    const cleanedDate = date.trim();
    console.log("DEBUG: Cleaned date:", cleanedDate);
    
    twiml.redirect(`/get-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(cleanedDate)}`);
  } else {
    console.log("DEBUG: No date received");
    twiml.say("Sorry, I didn't catch the date. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// GET TIME - UPDATED PROMPT (SPECIFIC TIME ZONE)
// -------------------------------------------------------
app.post('/get-time', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const date = decodeURIComponent(req.query.date || '');
  
  console.log("DEBUG: /get-time - Phone:", phone, "Name:", name, "Date:", date);

  const gather = twiml.gather({
    input: 'speech',
    action: `/process-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(date)}`,
    method: 'POST',
    speechTimeout: 2,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    `What time on ${date}? ` +
    `Please say the time in Pacific Time. ` +
    `For example: 2 PM Pacific, or 10 in the morning Pacific. ` +
    `Please include AM or PM and specify Pacific Time.`,
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear a time. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(date)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-time', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const date = decodeURIComponent(req.query.date || '');
  
  console.log("DEBUG: /process-time - Phone:", phone, "Name:", name, "Date:", date);
  console.log("DEBUG: SpeechResult:", req.body.SpeechResult);
  
  let time = req.body.SpeechResult || '';
  
  if (time && time.trim() !== '') {
    const cleanedTime = time.trim();
    console.log("DEBUG: Cleaned time:", cleanedTime);
    
    // Add Pacific Time if not already in time
    let finalTime = cleanedTime;
    if (!finalTime.toLowerCase().includes('pacific') && !finalTime.toLowerCase().includes('pt')) {
      finalTime = `${cleanedTime} Pacific Time`;
    }
    
    // Save appointment
    addAppointment(name, phone, date, finalTime);
    
    // Send SMS
    try {
      twilioClient.messages.create({
        body: `✅ New appointment: ${name} - ${date} at ${finalTime} (from: ${phone})`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log("DEBUG: SMS sent successfully");
    } catch (err) {
      console.log("ERROR sending SMS:", err);
    }
    
    twiml.say(
      `Perfect! Your appointment has been scheduled for ${date} at ${finalTime}. ` +
      `Thank you for choosing Altair Partners. Goodbye.`,
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
  } else {
    console.log("DEBUG: No time received");
    twiml.say("Sorry, I didn't catch the time. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(date)}`);
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

  console.log("DEBUG: /callback-request - Caller:", caller);

  twiml.say(
    "Your callback request has been submitted. We'll call you back as soon as possible. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  
  // Send SMS
  twilioClient.messages.create({
    body: `📞 Callback requested from ${caller}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });
  
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// VOICEMAIL - UPDATED PROMPT
// -------------------------------------------------------
app.post('/rep-busy', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("DEBUG: /rep-busy endpoint hit");

  twiml.say(
    "All representatives are currently busy. " +
    "Please leave a message after the beep. " +
    "This call may be monitored for quality assurance.",
    { voice: 'alice', language: 'en-US' }
  );

  twiml.record({
    action: '/voicemail-complete',
    maxLength: 120,
    playBeep: true,
    timeout: 10
  });

  twiml.say("No message recorded. Thank you for calling Altair Partners. Goodbye.", { voice: 'alice', language: 'en-US' });
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/voicemail-complete', (req, res) => {
  const twiml = new VoiceResponse();
  const url = req.body.RecordingUrl;
  const caller = req.body.From;

  console.log("DEBUG: /voicemail-complete - Caller:", caller, "URL:", url);

  // Send SMS
  twilioClient.messages.create({
    body: `📩 New voicemail from ${caller}: ${url}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  twiml.say("Thank you for your message. We'll get back to you as soon as possible. Goodbye.", { voice: 'alice', language: 'en-US' });
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// HEALTH CHECK
// -------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', (req, res) => {
  const db = loadDB();
  res.json({
    status: 'running',
    appointments: db,
    total: db.length
  });
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
const PORT = process.env.PORT || 1337;
app.listen(PORT, () => {
  console.log(`✅ IVR server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Debug: http://localhost:${PORT}/debug`);
});