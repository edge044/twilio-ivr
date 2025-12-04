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

  if (!digit) {
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

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
    twiml.say("Invalid option.");
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

  if (!digit) {
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    deleteAppointment(phone);
    twiml.say("Your appointment has been cancelled. Goodbye.");
    twiml.hangup();
  }

  else if (digit === '2') {
    deleteAppointment(phone);
    twiml.say("Let's reschedule your appointment.");
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }

  else {
    twiml.say("Invalid option.");
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// GET NAME - SIMPLE SPEECH RECOGNITION
// -------------------------------------------------------
app.post('/start-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
});

app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/process-name?phone=${encodeURIComponent(phone)}`,
    method: 'POST',
    speechTimeout: 2,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("Please say your first name.");
  
  twiml.say("Sorry, I didn't hear your name. Let's try again.");
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  // Get the name from speech
  let name = req.body.SpeechResult || '';
  
  console.log("DEBUG - Raw name received:", name);
  
  // Simple name cleaning logic
  if (name) {
    // Take only the first word (first name)
    const firstName = name.split(' ')[0];
    
    // Capitalize first letter
    const cleanedName = firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
    
    console.log("DEBUG - Cleaned name:", cleanedName);
    
    // Store in session or pass via URL
    twiml.redirect(`/get-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(cleanedName)}`);
  } else {
    twiml.say("Sorry, I didn't catch your name. Let's try again.");
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// GET DATE - SIMPLE SPEECH RECOGNITION
// -------------------------------------------------------
app.post('/get-date', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/process-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 2,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(`Thanks ${name}. What day would you like to schedule? For example, say Friday, or December 15th.`);
  
  twiml.say("Sorry, I didn't hear a date. Let's try again.");
  twiml.redirect(`/get-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-date', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  // Get the date from speech
  let date = req.body.SpeechResult || '';
  
  console.log("DEBUG - Raw date received:", date);
  
  if (date) {
    // Simple date cleaning - just use what we got
    const cleanedDate = date.trim();
    
    console.log("DEBUG - Cleaned date:", cleanedDate);
    
    twiml.redirect(`/get-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(cleanedDate)}`);
  } else {
    twiml.say("Sorry, I didn't catch the date. Let's try again.");
    twiml.redirect(`/get-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// GET TIME - SIMPLE SPEECH RECOGNITION
// -------------------------------------------------------
app.post('/get-time', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const date = decodeURIComponent(req.query.date || '');
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/process-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(date)}`,
    method: 'POST',
    speechTimeout: 2,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(`What time on ${date}? For example, say 2 PM, or 10 in the morning.`);
  
  twiml.say("Sorry, I didn't hear a time. Let's try again.");
  twiml.redirect(`/get-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(date)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-time', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const date = decodeURIComponent(req.query.date || '');
  
  // Get the time from speech
  let time = req.body.SpeechResult || '';
  
  console.log("DEBUG - Raw time received:", time);
  
  if (time) {
    // Simple time cleaning - just use what we got
    const cleanedTime = time.trim();
    
    console.log("DEBUG - Cleaned time:", cleanedTime);
    
    // Save the appointment
    addAppointment(name, phone, date, cleanedTime);
    
    // Send SMS confirmation
    try {
      twilioClient.messages.create({
        body: `✅ New appointment: ${name} - ${date} at ${cleanedTime} (from: ${phone})`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
    } catch (err) {
      console.log("SMS error:", err);
    }
    
    twiml.say(`Perfect ${name}! Your appointment has been scheduled for ${date} at ${cleanedTime}. Thank you! Goodbye.`);
    twiml.hangup();
  } else {
    twiml.say("Sorry, I didn't catch the time. Let's try again.");
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

  twiml.say("Your callback request has been submitted. We'll call you back as soon as possible. Goodbye.");
  
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