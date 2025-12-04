const express = require('express');
const https = require('https');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const app = express();

// ❤️ FIXED: Correct Google Web App URL (THE ONE YOU JUST SENT)
const APPOINTMENTS_API_URL = "https://script.google.com/a/macros/altairpartner.com/s/AKfycbyUc8dA2CMIAfytAlU_T4VXWi3Z9pKGO-LOJT9AwOKumDBaQ0Ju4ehpDfu9fQVHE6BsIQ/exec";

app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// SAFE JSON CHECK
function safeJSON(body) {
  if (!body || typeof body !== "string") return null;
  if (body.trim().startsWith("<")) return null; // HTML returned — not JSON
  try { return JSON.parse(body); }
  catch { return null; }
}

// GOOGLE SHEETS API CALLER
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
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        const json = safeJSON(body);
        if (!json) return reject("Google returned invalid JSON");
        resolve(json);
      });
    });

    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// -------------------------------------------------------
// MAIN MENU
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();

  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST'
  });

  gather.say(
    "Thank you for choosing Altair Partners. " +
    "Press 1 to cancel or schedule an appointment. " +
    "Press 3 to speak with a representative. " +
    "Press 9 to request a callback."
  );

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// HANDLE KEY
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
          action: `/appointment-manage?row=${response.row}&phone=${encodeURIComponent(callerPhone)}`,
          method: 'POST'
        });

        gather.say(
          `You have an appointment on ${response.date} at ${response.time}. ` +
          "Press 1 to cancel or 2 to reschedule."
        );

      } else {
        twiml.redirect(`/start-appointment?phone=${encodeURIComponent(callerPhone)}`);
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
    }

  } catch (err) {
    console.error("ERROR /handle-key", err);
    twiml.say("System error. Try again later.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CANCEL / RESCHEDULE
// -------------------------------------------------------
app.post('/appointment-manage', async (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const row = Number(req.query.row);
  const phone = req.query.phone;

  try {
    if (digit === '1') {
      await callAppointmentsApi({ action: "cancelAppointment", row });
      twiml.say("Your appointment has been cancelled.");
    }

    else if (digit === '2') {
      await callAppointmentsApi({ action: "cancelAppointment", row });
      twiml.say("Let's reschedule.");
      twiml.redirect(`/start-appointment?phone=${encodeURIComponent(phone)}`);
    }

    else {
      twiml.say("Invalid choice.");
    }

  } catch (err) {
    console.error("ERROR /appointment-manage", err);
    twiml.say("System failure.");
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// START APPOINTMENT (NAME)
// -------------------------------------------------------
app.post('/start-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone;

  const gather = twiml.gather({
    input: "speech",
    action: `/book-date?phone=${phone}`,
    method: "POST"
  });

  gather.say("Please say your full name.");

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// BOOK DATE
// -------------------------------------------------------
app.post('/book-date', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult;
  const phone = req.query.phone;

  const gather = twiml.gather({
    input: "speech",
    action: `/book-time?phone=${phone}&name=${encodeURIComponent(name)}`,
    method: "POST"
  });

  gather.say(`Thanks ${name}. What day would you like?`);

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// BOOK TIME
// -------------------------------------------------------
app.post('/book-time', (req, res) => {
  const twiml = new VoiceResponse();
  const date = req.body.SpeechResult;
  const name = req.query.name;
  const phone = req.query.phone;

  const gather = twiml.gather({
    input: "speech",
    action: `/confirm-booking?phone=${phone}&name=${name}&date=${encodeURIComponent(date)}`,
    method: "POST"
  });

  gather.say(`What time on ${date}?`);

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CONFIRM BOOKING
// -------------------------------------------------------
app.post('/confirm-booking', async (req, res) => {
  const twiml = new VoiceResponse();
  const time = req.body.SpeechResult;
  const { phone, name, date } = req.query;

  try {
    await callAppointmentsApi({
      action: "addAppointment",
      name,
      phone,
      date,
      time
    });

    twiml.say(`Your appointment for ${date} at ${time} has been saved.`);

  } catch (err) {
    console.error("ERROR /confirm-booking", err);
    twiml.say("Could not save appointment.");
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

  twiml.say("Callback request submitted.");

  twilioClient.messages.create({
    body: `📞 Callback requested from ${caller}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// VOICEMAIL
// -------------------------------------------------------
app.post('/rep-busy', (req, res) => {
  const twiml = new VoiceResponse();
  twiml.say("Representatives are busy. Leave a message.");

  twiml.record({
    action: '/voicemail-complete',
    maxLength: 60,
    playBeep: true
  });

  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/voicemail-complete', (req, res) => {
  const twiml = new VoiceResponse();
  const url = req.body.RecordingUrl;

  twilioClient.messages.create({
    body: `📩 New voicemail: ${url}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });

  twiml.say("Thank you. Goodbye.");

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// START SERVER
// -------------------------------------------------------
app.listen(1337, () => console.log("IVR server running."));
