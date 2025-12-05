const express = require('express');
const fs = require('fs');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const { OpenAI } = require('openai');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------------------------------------------------------
// OPENAI SETUP (СКРЫТЫЙ AI)
// -------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Контекст для "представителя" - креативное агенство
const REP_CONTEXT = `
You work at Altair Partners - a creative agency in Portland.
Help customers with their questions.

BUSINESS INFO:
- Hours: Monday to Friday, 10 AM to 5 PM Pacific Time
- Location: Portland, Oregon
- Services: Creative design, branding, marketing campaigns, video production
- For appointments: Transfer to booking system (press 1)

BEHAVIOR:
1. Friendly and professional
2. Keep answers short (1 sentence max)
3. If question about appointments → say "I'll transfer you to our booking system"
4. If about hours/location/services → answer directly
5. Sound human, not robotic
6. Never say you're AI or bot
`;

// Функция AI (скрытая)
async function getRepResponse(question, phone) {
  try {
    console.log(`🤖 AI Question from ${phone}: ${question}`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `${REP_CONTEXT}\n\nKeep response under 100 characters for phone.`
        },
        {
          role: "user",
          content: question
        }
      ],
      max_tokens: 80,
      temperature: 0.7
    });
    
    const response = completion.choices[0].message.content;
    console.log(`🤖 AI Response: ${response}`);
    
    return response;
    
  } catch (error) {
    console.error("AI Error:", error);
    return "Let me transfer you to our booking system for assistance.";
  }
}

// -------------------------------------------------------
// JSON DATABASE
// -------------------------------------------------------
const DB_PATH = "./appointments.json";

function loadDB() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      fs.writeFileSync(DB_PATH, '[]');
      return [];
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error("ERROR loading database:", error);
    return [];
  }
}

function saveDB(data) {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
  } catch (error) {
    console.error("ERROR saving database:", error);
  }
}

function findAppointment(phone) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  return db.find(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone === normalizedPhone;
  });
}

function addAppointment(name, phone, businessType, serviceType, date, time) {
  const db = loadDB();
  const normalizedPhone = phone.replace(/\D/g, '');
  
  const filteredDB = db.filter(a => {
    const normalizedApptPhone = a.phone.replace(/\D/g, '');
    return normalizedApptPhone !== normalizedPhone;
  });
  
  filteredDB.push({ 
    name, 
    phone,
    businessType,
    serviceType,
    date, 
    time,
    created: new Date().toISOString()
  });
  
  saveDB(filteredDB);
  console.log(`✅ Appointment added: ${name} - ${date} at ${time}`);
  
  return filteredDB.find(a => a.phone === phone);
}

// Calculate next available date (3 days from today)
function getNextAvailableDate() {
  const today = new Date();
  const nextDate = new Date(today);
  nextDate.setDate(today.getDate() + 3);
  
  const options = { weekday: 'long', month: 'long', day: 'numeric' };
  return nextDate.toLocaleDateString('en-US', options);
}

// -------------------------------------------------------
// MAIN MENU (4 OPTIONS)
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("📞 Main menu - Caller:", req.body.From);
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for choosing Altair Partners. " +
    "Press 1 to schedule an appointment. " +
    "Press 2 to speak with a representative. " +
    "Press 3 to request a callback. " +
    "Press 4 for partnership opportunities.",
    { voice: 'alice', language: 'en-US' }
  );

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

  console.log(`🔘 Menu option ${digit} - Phone: ${phone}`);

  if (!digit) {
    twiml.say("Invalid input. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    console.log("📅 Option 1 - Schedule appointment");
    const appt = findAppointment(phone);

    if (appt) {
      const gather = twiml.gather({
        numDigits: 1,
        action: `/appointment-manage?phone=${encodeURIComponent(phone)}`,
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I see you have an appointment scheduled on ${appt.date} at ${appt.time}. ` +
        "Press 1 to cancel this appointment. Press 2 to reschedule.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');

    } else {
      twiml.say("I don't see you in our appointment database. Let me ask you a few questions to schedule an appointment.", 
        { voice: 'alice', language: 'en-US' });
      twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    }
  }

  else if (digit === '2') {
    console.log("👤 Option 2 - Representative");
    twiml.redirect('/connect-representative');
  }

  else if (digit === '3') {
    console.log("📞 Option 3 - Callback request");
    twiml.redirect('/callback-request');
  }

  else if (digit === '4') {
    console.log("🤝 Option 4 - Partnership");
    twiml.redirect('/partnership');
  }

  else {
    twiml.say("Invalid option. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// REPRESENTATIVE - ТОЧНО КАК ТЫ ХОЧЕШЬ
// -------------------------------------------------------
app.post('/connect-representative', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("👤 Representative - asking for reason");

  const gather = twiml.gather({
    input: 'speech',
    action: '/confirm-reason',
    method: 'POST',
    speechTimeout: 5,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    "Before I connect you with a representative, please tell me the reason for your call.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/connect-representative');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/confirm-reason', (req, res) => {
  const twiml = new VoiceResponse();
  const reason = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`❓ Call reason: ${reason}`);
  
  if (!reason || reason.trim() === '') {
    twiml.say("I didn't hear your reason. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/start-rings?reason=${encodeURIComponent(reason)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`You are calling about: ${reason}. Is this correct? Say yes or no.`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's start over.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/connect-representative');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/start-rings', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const reason = req.query.reason;
  const phone = req.body.From;
  
  console.log(`✅ Reason confirmed: ${reason} - Response: ${response}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. Please tell me the reason for your call.", 
      { voice: 'alice', language: 'en-US' });
    twiml.redirect('/connect-representative');
    return res.type('text/xml').send(twiml.toString());
  }
  
  // "Окей вейт вайл ай трансфер"
  twiml.say("Okay, wait while I transfer you. Please hold.", 
    { voice: 'alice', language: 'en-US' });
  
  // 3 НАСТОЯЩИХ ГУДКА КАК В ТЕЛЕФОНЕ
  for (let i = 0; i < 3; i++) {
    // w = wait (0.5 сек), 1 = DTMF tone 1 (бип)
    twiml.play({ digits: 'w' }); // Пауза перед бипом
    twiml.play({ digits: '1' }); // Сам бип
    twiml.pause({ length: 1.5 }); // Пауза между бипами
  }
  
  // ПОСЛЕ ГУДКОВ
  twiml.say(
    "The wait time is greater than average, so I will help you with that. ",
    { voice: 'alice', language: 'en-US' }
  );
  
  // AI СЛУШАЕТ ВОПРОС
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("What would you like to know?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your question. Let me transfer you back to the main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/process-rep-question', async (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`🤖 Processing question: ${question}`);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/process-rep-question');
    return res.type('text/xml').send(twiml.toString());
  }
  
  // ИСПОЛЬЗУЕМ AI (но не говорим об этом)
  const aiResponse = await getRepResponse(question, phone);
  
  // ГОВОРИМ ОТВЕТ AI
  twiml.say(aiResponse, { voice: 'alice', language: 'en-US' });
  
  // Продолжаем разговор
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say("What else can I help you with?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("Or press any key to return to main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// APPOINTMENT FLOW - 3 ВОПРОСА С ПЕРЕСПРАШИВАНИЕМ
// -------------------------------------------------------
app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Getting name for: ${phone}`);

  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-name?phone=${encodeURIComponent(phone)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say("First question: What is your full name?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your name. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-name', (req, res) => {
  const twiml = new VoiceResponse();
  const name = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Name received: ${name} for ${phone}`);
  
  if (!name || name.trim() === '') {
    twiml.say("Sorry, I didn't catch your name. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Переспрашиваем имя
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${name}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`📝 Name verification: ${response} for ${name}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What is your full name?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-name?phone=${encodeURIComponent(phone)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Второй вопрос: тип бизнеса
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`Thanks ${name}. Second question: What type of business do you have?`, 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your business type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-business-type', (req, res) => {
  const twiml = new VoiceResponse();
  const businessType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  
  console.log(`🏢 Business type: ${businessType} for ${name}`);
  
  if (!businessType || businessType.trim() === '') {
    twiml.say("Sorry, I didn't catch your business type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Переспрашиваем бизнес тип
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${businessType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/get-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  console.log(`🏢 Business verification: ${response} for ${businessType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of business do you have?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-business-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Третий вопрос: тип услуги
  const gather = twiml.gather({
    input: 'speech',
    action: `/verify-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say("Third question: What type of service are you looking for?", 
    { voice: 'alice', language: 'en-US' });
  
  twiml.say("I didn't hear your service type. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/verify-service-type', (req, res) => {
  const twiml = new VoiceResponse();
  const serviceType = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  
  console.log(`🔧 Service type: ${serviceType} for ${name}`);
  
  if (!serviceType || serviceType.trim() === '') {
    twiml.say("Sorry, I didn't catch your service type. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Переспрашиваем тип услуги
  const gather = twiml.gather({
    input: 'speech dtmf',
    action: `/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(`I heard: ${serviceType}. Is this correct? Say yes or no.`, { voice: 'alice', language: 'en-US' });
  
  twiml.say("No response received. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/schedule-date', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  
  console.log(`🔧 Service verification: ${response} for ${serviceType}`);
  
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('no') || lowerResponse === '2') {
    twiml.say("Let's try again. What type of service are you looking for?", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/get-service-type?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Ближайший свободный день (3 дня после сегодня)
  const nextDate = getNextAvailableDate();
  
  const gather = twiml.gather({
    input: 'speech',
    action: `/schedule-time?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}&date=${encodeURIComponent(nextDate)}`,
    method: 'POST',
    speechTimeout: 3,
    timeout: 10
  });
  
  gather.say(
    `Perfect. The next available date is ${nextDate}. ` +
    "What time works for you on that day? Please say the time including AM or PM.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear a time. Please try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect(`/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`);
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/schedule-time', (req, res) => {
  const twiml = new VoiceResponse();
  const time = req.body.SpeechResult || '';
  const phone = req.query.phone || req.body.From;
  const name = decodeURIComponent(req.query.name || '');
  const businessType = decodeURIComponent(req.query.businessType || '');
  const serviceType = decodeURIComponent(req.query.serviceType || '');
  const date = decodeURIComponent(req.query.date || '');
  
  console.log(`⏰ Time received: ${time} for ${date}`);
  
  if (!time || time.trim() === '') {
    twiml.say("Sorry, I didn't catch the time. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect(`/schedule-date?phone=${encodeURIComponent(phone)}&name=${encodeURIComponent(name)}&businessType=${encodeURIComponent(businessType)}&serviceType=${encodeURIComponent(serviceType)}`);
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Clean time
  let cleanedTime = time.trim()
    .replace(/NPM/gi, 'PM')
    .replace(/MPM/gi, 'PM')
    .replace(/AMM/gi, 'AM')
    .replace(/B ?M/gi, 'PM')
    .replace(/A ?M/gi, 'AM')
    .replace(/P ?M/gi, 'PM')
    .replace(/\s+/g, ' ')
    .trim();
  
  // Add Pacific Time
  if (!cleanedTime.toLowerCase().includes('pacific') && !cleanedTime.toLowerCase().includes('pt')) {
    cleanedTime = `${cleanedTime} Pacific Time`;
  }
  
  // Check if appointment already exists
  const existingAppt = findAppointment(phone);
  if (existingAppt) {
    twiml.say(
      "I see you already have an existing appointment. Please cancel it first before scheduling a new one. " +
      "Returning to main menu.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Save appointment
  const appointmentSaved = addAppointment(name, phone, businessType, serviceType, date, cleanedTime);
  
  if (appointmentSaved) {
    // Send SMS confirmation to CLIENT с запросом email
    try {
      twilioClient.messages.create({
        body: `✅ Thank you for your appointment with Altair Partners!\n\n` +
              `Your appointment: ${date} at ${cleanedTime}\n` +
              `Name: ${name}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}\n\n` +
              `For further communication with our creative director, please reply with your email address.`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: phone
      });
      console.log(`📱 SMS sent to client ${phone}`);
    } catch (err) {
      console.log("ERROR sending SMS to client:", err);
    }
    
    // Send notification to YOU
    try {
      twilioClient.messages.create({
        body: `📅 NEW APPOINTMENT\n` +
              `Name: ${name}\n` +
              `Phone: ${phone}\n` +
              `Date: ${date} at ${cleanedTime}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log(`📱 Notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending admin notification:", err);
    }
  }
  
  twiml.say(
    `Excellent! Your appointment has been scheduled for ${date} at ${cleanedTime}. ` +
    "You will receive an SMS shortly. Please check your messages and reply with your email address " +
    "for further communication with our creative director. Thank you for choosing Altair Partners!",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CALLBACK REQUEST (Option 3)
// -------------------------------------------------------
app.post('/callback-request', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`📞 Callback request from: ${phone}`);

  twiml.say(
    "Your callback request has been submitted. We'll call you back as soon as possible. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  
  // Send SMS
  twilioClient.messages.create({
    body: `📞 Callback requested from ${phone}`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: process.env.MY_PERSONAL_NUMBER
  });
  
  twiml.hangup();

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// PARTNERSHIP (Option 4)
// -------------------------------------------------------
app.post('/partnership', (req, res) => {
  const twiml = new VoiceResponse();
  
  console.log("🤝 Partnership inquiry");

  twiml.say(
    "Thank you for your interest in partnership opportunities. " +
    "Please email us at partners@altairpartners.com for more information. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  twiml.hangup();
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CANCEL / RESCHEDULE APPOINTMENT
// -------------------------------------------------------
app.post('/appointment-manage', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.query.phone;

  console.log(`❌ Managing appointment for: ${phone}`);

  if (!digit) {
    twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    // Cancel appointment
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    const initialLength = db.length;
    
    db = db.filter(a => {
      const normalizedApptPhone = a.phone.replace(/\D/g, '');
      return normalizedApptPhone !== normalizedPhone;
    });
    
    if (db.length < initialLength) {
      saveDB(db);
      console.log(`❌ Appointment cancelled for ${phone}`);
      
      twiml.say("Your appointment has been cancelled. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    } else {
      twiml.say("No appointment found to cancel. Returning to main menu.", { voice: 'alice', language: 'en-US' });
      twiml.redirect('/voice');
    }
  }

  else if (digit === '2') {
    // Reschedule
    let db = loadDB();
    const normalizedPhone = phone.replace(/\D/g, '');
    
    db = db.filter(a => {
      const normalizedApptPhone = a.phone.replace(/\D/g, '');
      return normalizedApptPhone !== normalizedPhone;
    });
    
    saveDB(db);
    
    console.log(`🔄 Rescheduling for: ${phone}`);
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
// DEBUG ENDPOINTS
// -------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', (req, res) => {
  const appointments = loadDB();
  
  res.json({
    status: 'running',
    appointments: appointments,
    totalAppointments: appointments.length,
    nextAvailableDate: getNextAvailableDate(),
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
  console.log(`✅ Next available date: ${getNextAvailableDate()}`);
  console.log(`🤖 AI Representative is ready (hidden)`);
});