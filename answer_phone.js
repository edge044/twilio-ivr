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
  try {
    if (!fs.existsSync(DB_PATH)) {
      console.log("Creating new appointments.json file");
      fs.writeFileSync(DB_PATH, '[]');
      return [];
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    const parsed = JSON.parse(data || '[]');
    console.log(`DEBUG: Loaded ${parsed.length} appointments from database`);
    return parsed;
  } catch (error) {
    console.error("ERROR loading database:", error);
    return [];
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    console.log(`DEBUG: Saved ${data.length} appointments to database`);
  } catch (error) {
    console.error("ERROR saving database:", error);
  }
}

function findAppointment(phone) {
  const db = loadDB();
  console.log(`DEBUG: Looking for appointment for phone: ${phone}`);
  console.log(`DEBUG: Database has ${db.length} appointments`);
  
  const normalizedPhone = phone.replace(/\D/g, '');
  
  const appointment = db.find(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone === normalizedPhone;
  });
  
  if (appointment) {
    console.log("DEBUG: Found appointment:", appointment);
  } else {
    console.log("DEBUG: No appointment found for this number");
  }
  
  return appointment;
}

function addAppointment(name, phone, date, time) {
  const db = loadDB();
  
  const normalizedPhone = phone.replace(/\D/g, '');
  const filteredDB = db.filter(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone !== normalizedPhone;
  });
  
  filteredDB.push({ 
    name, 
    phone,
    date, 
    time,
    created: new Date().toISOString()
  });
  
  saveDB(filteredDB);
  console.log(`DEBUG: Added appointment for ${phone}: ${date} at ${time}`);
}

function deleteAppointment(phone) {
  let db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  const initialLength = db.length;
  db = db.filter(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone !== normalizedPhone;
  });
  
  if (db.length < initialLength) {
    saveDB(db);
    console.log(`DEBUG: Deleted appointment for ${phone}`);
  } else {
    console.log(`DEBUG: No appointment found to delete for ${phone}`);
  }
}

// -------------------------------------------------------
// MAIN MENU - NO MENTION OF AI
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("DEBUG: /voice endpoint hit");
  console.log("DEBUG: Caller:", req.body.From);
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for choosing Altair Partners. This call may be monitored for quality assurance. " +
    "Press 1 to schedule or cancel an appointment. " +
    "Press 2 to speak with a representative. " + // NO AI MENTION
    "Press 3 to request a callback.",
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
    console.log("DEBUG: Option 1 selected - Checking for existing appointment");
    const appt = findAppointment(phone);

    if (appt) {
      console.log("DEBUG: Found existing appointment:", appt);
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I see you have an appointment scheduled on ${appt.date} at ${appt.time}. ` +
        "Press 1 to cancel this appointment. " +
        "Press 2 to reschedule.",
        { voice: 'alice', language: 'en-US' }
      );

      // Fallback if no input
      twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');

    } else {
      console.log("DEBUG: No existing appointment found, starting new");
      twiml.say("Let's schedule a new appointment.", { voice: 'alice', language: 'en-US' });
      twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    }
  }

  else if (digit === '2') { // REPRESENTATIVE - NOT AI
    console.log("DEBUG: Option 2 selected - Representative");
    twiml.redirect('/connect-representative');
  }

  else if (digit === '3') { // CALLBACK
    console.log("DEBUG: Option 3 selected - Callback");
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
// CONNECT REPRESENTATIVE - WITH HOLD MUSIC & BEEPS
// -------------------------------------------------------
app.post('/connect-representative', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("DEBUG: /connect-representative endpoint hit");

  // Say "please wait" with robot voice
  twiml.say(
    "Please wait while I connect you with one of our representatives.",
    { voice: 'alice', language: 'en-US' }
  );

  // Play hold music for 4 seconds
  twiml.play({}, 'https://demo.twilio.com/docs/classic.mp3');
  twiml.pause({ length: 4 });

  // Play 3 beeps (using say with short pauses)
  twiml.say("beep", { voice: 'alice', language: 'en-US' });
  twiml.pause({ length: 0.5 });
  twiml.say("beep", { voice: 'alice', language: 'en-US' });
  twiml.pause({ length: 0.5 });
  twiml.say("beep", { voice: 'alice', language: 'en-US' });
  twiml.pause({ length: 0.5 });

  // After beeps, "representative answers" with human-like voice
  // Using Google voices for more natural sound
  twiml.say(
    "Thank you for choosing Altair Partners. How can I help you?",
    { 
      voice: 'Google.en-US-Standard-B', // Male voice
      language: 'en-US'
    }
  );

  // Now listen for speech with NO DELAY
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-representative-question',
    method: 'POST',
    speechTimeout: 1, // SHORT timeout - no delay
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true,
    profanityFilter: false
  });

  // If no speech, redirect to voicemail
  twiml.say("I didn't hear your question. Let me transfer you to our messaging system.", { 
    voice: 'Google.en-US-Standard-B', 
    language: 'en-US' 
  });
  twiml.redirect('/rep-busy');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// PROCESS REPRESENTATIVE QUESTION - FAST RESPONSE
// -------------------------------------------------------
app.post('/process-representative-question', (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log("DEBUG: /process-representative-question - Phone:", phone);
  console.log("DEBUG: Question:", question);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { 
      voice: 'Google.en-US-Standard-B', 
      language: 'en-US' 
    });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  // SIMPLE RESPONSES (NO AI) - FAST RESPONSE, NO DELAY
  const lowerQuestion = question.toLowerCase();
  
  if (lowerQuestion.includes('hour') || lowerQuestion.includes('open') || lowerQuestion.includes('time')) {
    twiml.say(
      "Our office hours are Monday to Friday, 9 AM to 6 PM Pacific Time.",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
  }
  else if (lowerQuestion.includes('where') || lowerQuestion.includes('location') || lowerQuestion.includes('address')) {
    twiml.say(
      "We are located in San Francisco, California.",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
  }
  else if (lowerQuestion.includes('service') || lowerQuestion.includes('what do you') || lowerQuestion.includes('help')) {
    twiml.say(
      "We provide business consulting, financial advisory, and strategic planning services.",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
  }
  else if (lowerQuestion.includes('appointment') || lowerQuestion.includes('book') || lowerQuestion.includes('schedule')) {
    twiml.say(
      "For appointments, I'll transfer you to our booking system.",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
    twiml.pause({ length: 0.5 }); // Short pause
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }
  else if (lowerQuestion.includes('cancel') || lowerQuestion.includes('reschedule')) {
    twiml.say(
      "For canceling or rescheduling appointments, I'll transfer you to our booking system.",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
    twiml.pause({ length: 0.5 }); // Short pause
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }
  else if (lowerQuestion.includes('human') || lowerQuestion.includes('speak to real')) {
    twiml.say(
      "I'll connect you with a human representative.",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
    twiml.redirect('/rep-busy');
    return res.type('text/xml').send(twiml.toString());
  }
  else {
    // Default response
    twiml.say(
      "Thank you for your question. I can help with appointments, business hours, location, and services. What else can I help you with?",
      { 
        voice: 'Google.en-US-Standard-B', 
        language: 'en-US' 
      }
    );
  }
  
  // Continue conversation - FAST response, no delay
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-representative-question',
    method: 'POST',
    speechTimeout: 1, // VERY SHORT timeout
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("What else can I help you with?", { 
    voice: 'Google.en-US-Standard-B', 
    language: 'en-US' 
  });
  
  // Option to go back to menu
  twiml.say("Or press any key to return to the main menu.");
  twiml.redirect('/voice');
  
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
    speechTimeout: 2, // Shorter timeout
    timeout: 8,
    speechModel: 'numbers_and_commands',
    enhanced: true,
    profanityFilter: false
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
  console.log("DEBUG: Raw SpeechResult:", req.body.SpeechResult);
  
  let name = req.body.SpeechResult || '';
  
  if (name && name.trim() !== '') {
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
// GET DATE
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
    speechTimeout: 2, // Shorter timeout
    timeout: 8,
    speechModel: 'numbers_and_commands',
    enhanced: true,
    profanityFilter: false
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
  console.log("DEBUG: Raw SpeechResult:", req.body.SpeechResult);
  
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
// GET TIME - NO DELAY
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
    speechTimeout: 2, // Shorter timeout
    timeout: 8,
    speechModel: 'numbers_and_commands',
    enhanced: true,
    profanityFilter: false
  });
  
  gather.say(
    `What time on ${date}? ` +
    `Please say the time clearly. For example: 10 P M, or 2 30 P M. ` +
    `Make sure to say P M or A M clearly.`,
    { voice: 'alice', language: 'en-US', slow: true }
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
  console.log("DEBUG: Raw SpeechResult:", req.body.SpeechResult);
  
  let time = req.body.SpeechResult || '';
  
  if (time && time.trim() !== '') {
    let cleanedTime = time.trim();
    
    cleanedTime = cleanedTime
      .replace(/NPM/gi, 'PM')
      .replace(/MPM/gi, 'PM')
      .replace(/AMM/gi, 'AM')
      .replace(/B ?M/gi, 'PM')
      .replace(/A ?M/gi, 'AM')
      .replace(/P ?M/gi, 'PM')
      .replace(/\s+/g, ' ')
      .trim();
    
    let finalTime = cleanedTime;
    if (!finalTime.toLowerCase().includes('pacific') && !finalTime.toLowerCase().includes('pt')) {
      finalTime = `${cleanedTime} Pacific Time`;
    }
    
    console.log("DEBUG: Cleaned time:", cleanedTime);
    console.log("DEBUG: Final time:", finalTime);
    
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
// VOICEMAIL
// -------------------------------------------------------
app.post('/rep-busy', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("DEBUG: /rep-busy endpoint hit");

  twiml.say(
    "Thank you for your patience. All representatives are currently assisting other customers. " +
    "Please leave a message after the beep, or press 1 to return to the main menu.",
    { voice: 'alice', language: 'en-US' }
  );

  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-voicemail-choice',
    method: 'POST',
    timeout: 5
  });
  
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

app.post('/handle-voicemail-choice', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  
  if (digit === '1') {
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
  } else {
    twiml.redirect('/rep-busy');
  }
  
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
// DEBUG ENDPOINTS
// -------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', (req, res) => {
  const db = loadDB();
  res.json({
    status: 'running',
    appointments: db,
    total: db.length,
    timestamp: new Date().toISOString()
  });
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
const PORT = process.env.PORT || 1337;
app.listen(PORT, () => {
  console.log(`✅ IVR Server running on port ${PORT}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Debug: http://localhost:${PORT}/debug`);
});