const express = require('express');
const https = require('https');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();

// ✅ NEW Google Sheets Apps Script Web App URL (USE THIS)
const APPOINTMENTS_API_URL = "https://script.google.com/macros/s/AKfycbzt-ns9b2nE9fnfmYv62YMnjMIYU65rBbhEHgfZAtr9_RseYXtffzj2LBJNA1W9RrE/exec";

// Middleware
app.use(express.urlencoded({ extended: false }));
app.use(express.json());


// -------------------------------------------------------
// HELPER: CALL GOOGLE SHEETS APPOINTMENTS API
// -------------------------------------------------------
function callAppointmentsApi(payload) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const url = new URL(APPOINTMENTS_API_URL);

    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname + url.search,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(body);
          resolve(json);
        } catch (err) {
          console.error('Error parsing appointments API response:', err, body);
          reject(err);
        }
      });
    });

    req.on('error', (err) => {
      console.error('Error calling appointments API:', err);
      reject(err);
    });

    req.write(data);
    req.end();
  });
}


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
    "Thank you for choosing Altair Partners. Your call may be monitored for quality assurance. " +
    "Press 1 to cancel or schedule an appointment. Press 3 to speak with one of our representatives. " +
    "Press 9 if you would like a callback."
  );

  res.type('text/xml');
  res.send(twiml.toString());
});


// -------------------------------------------------------
// MENU HANDLER (SMART APPOINTMENT LOGIC)
// -------------------------------------------------------
app.post('/handle-key', async (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const callerPhone = req.body.From;

  try {
    if (digit === '1') {
      const response = await callAppointmentsApi({
        action: "findAppointment",
        phone: callerPhone
      });

      if (response.status === "found") {
        const gather = twiml.gather({
          numDigits: 1,
          action: `/appointment-manage?row=${encodeURIComponent(response.row)}&phone=${encodeURIComponent(callerPhone)}`,
          method: 'POST'
        });

        gather.say(
          `I see you have an appointment on ${response.date} at ${response.time} Pacific time. ` +
          "Press 1 to cancel this appointment. Press 2 to reschedule it."
        );

      } else {
        twiml.redirect(`/start-appointment?phone=${encodeURIComponent(callerPhone)}`);
      }

    } else if (digit === '3') {
      twiml.say("Please wait while I connect you with one of our representatives.");
      twiml.redirect('/rep-busy');

    } else if (digit === '9') {
      twiml.redirect('/callback-request');

    } else {
      twiml.say("Invalid option. Goodbye.");
    }

  } catch (err) {
    console.error("Error in /handle-key:", err);
    twiml.say("We are experiencing technical difficulties. Please try again later.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});


// -------------------------------------------------------
// APPOINTMENT MANAGE (CANCEL OR RESCHEDULE)
// -------------------------------------------------------
app.post('/appointment-manage', async (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const row = req.query.row;
  const phone = req.query.phone;

  try {
    if (digit === '1') {
      await callAppointmentsApi({
        action: "cancelAppointment",
        row: Number(row)
      });

      twiml.say("Your appointment has been cancelled. Goodbye.");

    } else if (digit === '2') {
      await callAppointmentsApi({
        action: "cancelAppointment",
        row: Number(row)
      });

      twiml.say("Okay, let's reschedule your appointment.");
      twiml.redirect(`/start-appointment?phone=${encodeURIComponent(phone)}`);

    } else {
      twiml.say("Invalid choice. Goodbye.");
    }

  } catch (err) {
    console.error("Error in /appointment-manage:", err);
    twiml.say("We are experiencing difficulties. Please try later.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});


// -------------------------------------------------------
// START NEW APPOINTMENT — ASK FOR NAME
// -------------------------------------------------------
app.post('/start-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;

  const gather = twiml.gather({
    input: "speech",
    action: `/book-date?phone=${encodeURIComponent(phone)}`,
    method: "POST"
  });

  gather.say("To schedule a new appointment, please say your full name after the beep.");

  res.type('text/xml');
  res.send(twiml.toString());
});


// -------------------------------------------------------
// ASK FOR DATE
// -------------------------------------------------------
app.post('/book-date', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone;
  const name = req.body.SpeechResult || "Unknown";

  const gather = twiml.gather({
    input: "speech",
    action: `/book-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: "POST"
  });

  gather.say(`Thanks, ${name}. What day would you like your appointment?`);

  res.type('text/xml');
  res.send(twiml.toString());
});


// -------------------------------------------------------
// ASK FOR TIME
// -------------------------------------------------------
app.post('/book-time', (req, res) => {
  const twiml = new VoiceResponse();
  const date = req.body.SpeechResult || "an unspecified date";
  const phone = req.query.phone;
  const name = req.query.name;

  const gather = twiml.gather({
    input: "speech",
    action: `/confirm-booking?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&date=${encodeURIComponent(date)}`,
    method: "POST"
  });

  gather.say(`Great. You said ${date}. What time works best for you?`);

  res.type('text/xml');
  res.send(twiml.toString());
});


// -------------------------------------------------------
// CONFIRM & SAVE APPOINTMENT
// -------------------------------------------------------
app.post('/confirm-booking', async (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone;
  const name = req.query.name;
  const date = req.query.date;
  const time = req.body.SpeechResult || "an unspecified time";

  try {
    await callAppointmentsApi({
      action: "addAppointment",
      name,
      phone,
      date,
      time
    });

    twiml.say(`Perfect. Your appointment for ${date} at ${time} Pacific time has been saved. Thank you for calling Altair Partners.`);

  } catch (err) {
    console.error("Error in /confirm-booking:", err);
    twiml.say("We could not save your appointment due to a system error. Please try later.");
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

  twiml.say("All of our representatives are currently busy. Please leave a message after the beep.");

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
    body: `📩 New Voicemail:\n${recordingUrl}`,
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
