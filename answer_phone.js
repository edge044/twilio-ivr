const express = require('express');
const fs = require('fs');
const path = require('path');
const VoiceResponse = require('twilio').twiml.VoiceResponse;
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);
const { OpenAI } = require('openai');
const { startReminderScheduler, triggerTestReminder } = require('./reminders');
const { isWithinBusinessHours, getTimeUntilOpen, getBusinessStatus } = require('./checkBusinessHours');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

// -------------------------------------------------------
// ROOT ENDPOINT
// -------------------------------------------------------
app.get('/', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.send(`
    <html>
      <body style="font-family: Arial; padding: 20px;">
        <h1>✅ Altair Partners IVR Server</h1>
        <p>Status: <strong>${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}</strong></p>
        <p>Current Time (PST): ${businessStatus.currentTime}</p>
        <p>Business Hours: ${businessStatus.hours}</p>
        <p>Location: ${businessStatus.location}</p>
        <p>${businessStatus.isOpen ? '✅ Currently open' : '⏰ ' + businessStatus.nextOpenTime}</p>
        <p>Endpoints:</p>
        <ul>
          <li><a href="/health">/health</a> - Health check</li>
          <li><a href="/debug">/debug</a> - Debug info</li>
          <li><a href="/logs">/logs</a> - Call logs</li>
          <li><a href="/appointments">/appointments</a> - All appointments</li>
          <li><a href="/conversations">/conversations</a> - AI conversations</li>
          <li><a href="/reminders">/reminders</a> - Reminder logs</li>
          <li><a href="/business-status">/business-status</a> - Business hours check</li>
        </ul>
        <p>Twilio Webhook: POST /voice</p>
        <p>⏰ Reminder System: Calls ONE DAY BEFORE appointment at 2 PM Pacific Time</p>
        <p>🔄 Next check: Every 5 minutes</p>
      </body>
    </html>
  `);
});

// -------------------------------------------------------
// OPENAI SETUP
// -------------------------------------------------------
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Контекст для AI
const REP_CONTEXT = `
You work at Altair Partners - a creative agency in Portland.

BUSINESS INFO:
- Hours: Monday to Friday, 10 AM to 5 PM Pacific Time
- Location: Portland, Oregon
- Services: Creative design, branding, marketing campaigns, video production
- For appointments: Say "I'll transfer you to our booking system"

BEHAVIOR:
1. Keep answers VERY SHORT (max 10 words)
2. If question about appointments → say "I'll transfer you to our booking system"
3. If about hours/location/services → answer directly
4. If customer says goodbye → say "Goodbye" and end call
5. Sound human but be concise
`;

// Быстрый AI ответ
async function getRepResponse(question, phone) {
  try {
    console.log(`🤖 AI Question: ${question}`);
    
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content: `${REP_CONTEXT}\n\nRespond in 5-10 words maximum.`
        },
        {
          role: "user",
          content: question
        }
      ],
      max_tokens: 30,
      temperature: 0.3
    });
    
    const response = completion.choices[0].message.content;
    console.log(`🤖 AI Response: ${response}`);
    
    return response;
    
  } catch (error) {
    console.error("AI Error:", error);
    return "Let me transfer you to our booking system.";
  }
}

// Проверка серьезных вопросов (law, court, big money)
function isSeriousQuestion(question) {
  const lower = question.toLowerCase();
  const seriousKeywords = [
    'law', 'legal', 'attorney', 'lawyer', 'court', 'lawsuit', 'sue',
    'million', 'billion', '100k', '500k', 'investment', 'laws', 'contract',
    'legal action', 'attorney', 'litigation', 'judge', 'lawsuit', 'settlement'
  ];
  
  return seriousKeywords.some(keyword => lower.includes(keyword));
}

// -------------------------------------------------------
// JSON DATABASE & LOGGING
// -------------------------------------------------------
const DB_PATH = "./appointments.json";
const CALL_LOGS_PATH = "./call_logs.json";
const AI_CONVERSATIONS_PATH = "./ai_conversations.json";
const REMINDERS_LOG = "./reminders_log.json";

// Функция для записи логов звонков
function logCall(phone, action, details = {}) {
  try {
    let logs = [];
    if (fs.existsSync(CALL_LOGS_PATH)) {
      const data = fs.readFileSync(CALL_LOGS_PATH, "utf8");
      logs = JSON.parse(data || '[]');
    }
    
    logs.push({
      phone,
      action,
      details,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    });
    
    // Сохраняем только последние 1000 записей
    if (logs.length > 1000) {
      logs = logs.slice(-1000);
    }
    
    fs.writeFileSync(CALL_LOGS_PATH, JSON.stringify(logs, null, 2));
    console.log(`📝 Call logged: ${phone} - ${action}`);
    
  } catch (error) {
    console.error("ERROR logging call:", error);
  }
}

// Функция для записи AI разговоров
function logAIConversation(phone, question, response) {
  try {
    let conversations = [];
    if (fs.existsSync(AI_CONVERSATIONS_PATH)) {
      const data = fs.readFileSync(AI_CONVERSATIONS_PATH, "utf8");
      conversations = JSON.parse(data || '[]');
    }
    
    conversations.push({
      phone,
      question,
      response,
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleString('en-US', { 
        timeZone: 'America/Los_Angeles',
        hour12: true,
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      })
    });
    
    // Сохраняем только последние 500 разговоров
    if (conversations.length > 500) {
      conversations = conversations.slice(-500);
    }
    
    fs.writeFileSync(AI_CONVERSATIONS_PATH, JSON.stringify(conversations, null, 2));
    console.log(`🤖 AI conversation logged: ${phone}`);
    
  } catch (error) {
    console.error("ERROR logging AI conversation:", error);
  }
}

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
  
  const appointment = { 
    name, 
    phone,
    businessType,
    serviceType,
    date, 
    time,
    created: new Date().toISOString(),
    timestamp: new Date().toLocaleString('en-US', { 
      timeZone: 'America/Los_Angeles',
      hour12: true,
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  };
  
  filteredDB.push(appointment);
  
  saveDB(filteredDB);
  console.log(`✅ Appointment added: ${name} - ${date} at ${time}`);
  
  // Логируем звонок
  logCall(phone, 'APPOINTMENT_SCHEDULED', {
    name,
    businessType,
    serviceType,
    date,
    time
  });
  
  return appointment;
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
// MAIN MENU (5 OPTIONS)
// -------------------------------------------------------
app.post('/voice', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("📞 Main menu - Caller:", phone);
  
  // Логируем входящий звонок
  logCall(phone, 'CALL_RECEIVED', {
    caller: phone,
    time: new Date().toLocaleTimeString()
  });
  
  const gather = twiml.gather({
    numDigits: 1,
    action: '/handle-key',
    method: 'POST',
    timeout: 10
  });

  gather.say(
    "Thank you for choosing Altair Partners. This call may be monitored for quality assurance. " +
    "Press 1 to schedule an appointment. " +
    "Press 2 to speak with a representative. " +
    "Press 3 to request a callback. " +
    "Press 4 for partnership opportunities. " +
    "Press 7 to talk with a creative director.",
    { voice: 'alice', language: 'en-US' }
  );

  twiml.say("Please select an option.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/voice');

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// TRANSFER TO APPOINTMENT FLOW
// -------------------------------------------------------
app.post('/transfer-to-appointment', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log(`📅 Transferring to appointment flow for: ${phone}`);
  
  // Логируем переход
  logCall(phone, 'APPOINTMENT_FLOW_STARTED');
  
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
  
  // Логируем выбор меню
  logCall(phone, `MENU_OPTION_${digit}`);

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
    
    // Проверяем рабочее время
    if (isWithinBusinessHours()) {
      twiml.redirect('/connect-representative');
    } else {
      // ЗАКРЫТО - предлагаем опции
      const nextOpenTime = getTimeUntilOpen();
      const gather = twiml.gather({
        numDigits: 1,
        action: '/closed-hours-options',
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
        "To request a callback, press 1. To leave a voice message, press 2. " +
        "To return to the main menu, press 9.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    }
  }

  else if (digit === '3') {
    console.log("📞 Option 3 - Callback request");
    twiml.redirect('/callback-request');
  }

  else if (digit === '4') {
    console.log("🤝 Option 4 - Partnership");
    twiml.redirect('/partnership');
  }

  else if (digit === '7') {
    console.log("🎨 Option 7 - Creative Director");
    
    // Проверяем рабочее время
    if (isWithinBusinessHours()) {
      twiml.redirect('/creative-director');
    } else {
      // ЗАКРЫТО - предлагаем опции
      const nextOpenTime = getTimeUntilOpen();
      const gather = twiml.gather({
        numDigits: 1,
        action: '/closed-hours-options',
        method: 'POST',
        timeout: 10
      });

      gather.say(
        `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
        "To request a callback, press 1. To leave a voice message, press 2. " +
        "To return to the main menu, press 9.",
        { voice: 'alice', language: 'en-US' }
      );

      twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
      twiml.hangup();
    }
  }

  else {
    twiml.say("Invalid option. Please try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CLOSED HOURS OPTIONS
// -------------------------------------------------------
app.post('/closed-hours-options', (req, res) => {
  const twiml = new VoiceResponse();
  const digit = req.body.Digits;
  const phone = req.body.From;

  console.log(`🔘 Closed hours option ${digit} - Phone: ${phone}`);
  
  logCall(phone, `CLOSED_HOURS_OPTION_${digit}`);

  if (!digit) {
    twiml.say("No selection made. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
    // Callback request when closed
    console.log("📞 Callback request during closed hours");
    
    twiml.say(
      "Your callback request has been submitted. We'll call you back during our next business hours. " +
      "Thank you for calling Altair Partners. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    
    // Отправляем SMS админу
    try {
      twilioClient.messages.create({
        body: `📞 AFTER-HOURS Callback requested from ${phone} (Closed hours)`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log(`📱 After-hours callback notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending admin notification:", err);
    }
    
    logCall(phone, 'AFTER_HOURS_CALLBACK_REQUESTED');
    twiml.hangup();
  }

  else if (digit === '2') {
    // Voice message when closed
    console.log("🎤 Voice message during closed hours");
    
    const gather = twiml.gather({
      input: 'speech',
      action: '/record-voice-message',
      method: 'POST',
      speechTimeout: 10,
      timeout: 30,
      speechModel: 'phone_call',
      enhanced: true
    });
    
    gather.say(
      "Please leave your voice message after the beep. When you are finished, simply hang up or press the pound key.",
      { voice: 'alice', language: 'en-US' }
    );
    
    twiml.say("I didn't hear your message. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/closed-hours-options');
  }

  else if (digit === '9') {
    twiml.say("Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }

  else {
    twiml.say("Invalid option. Goodbye.", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
  }

  res.type('text/xml');
  res.send(twiml.toString());
});

// Запись голосового сообщения
app.post('/record-voice-message', (req, res) => {
  const twiml = new VoiceResponse();
  const message = req.body.SpeechResult || '';
  const phone = req.body.From;

  console.log(`🎤 Voice message recorded from: ${phone}`);
  console.log(`📝 Message: ${message.substring(0, 100)}...`);
  
  if (message && message.trim() !== '') {
    // Отправляем SMS админу с сообщением
    try {
      twilioClient.messages.create({
        body: `🎤 AFTER-HOURS VOICE MESSAGE from ${phone}:\n\n"${message.substring(0, 300)}"`,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: process.env.MY_PERSONAL_NUMBER
      });
      console.log(`📱 Voice message notification sent to admin`);
    } catch (err) {
      console.log("ERROR sending voice message notification:", err);
    }
    
    logCall(phone, 'VOICE_MESSAGE_RECORDED', {
      messageLength: message.length,
      preview: message.substring(0, 100)
    });
    
    twiml.say(
      "Thank you for your message. We will get back to you during our next business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
  } else {
    twiml.say(
      "I didn't hear your message. Please try again or call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
  }
  
  twiml.hangup();
  res.type('text/xml').send(twiml.toString());
});

// -------------------------------------------------------
// REPRESENTATIVE (Option 2) - БЫСТРЫЙ AI
// -------------------------------------------------------
app.post('/connect-representative', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("👤 Representative - asking for reason");
  
  // Проверяем еще раз (на всякий случай)
  if (!isWithinBusinessHours()) {
    const nextOpenTime = getTimeUntilOpen();
    twiml.say(
      `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
      "Please call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Логируем
  logCall(phone, 'REPRESENTATIVE_SELECTED');

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
  
  twiml.say("Okay, wait while I transfer you. Please hold.", 
    { voice: 'alice', language: 'en-US' });
  
  // 3 быстрых гудка
  for (let i = 0; i < 3; i++) {
    twiml.play({ digits: 'w' });
    twiml.play({ digits: '1' });
    twiml.pause({ length: 1 });
  }
  
  twiml.say(
    "The wait time is greater than average, so I will help you with that. ",
    { voice: 'alice', language: 'en-US' }
  );
  
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 2,
    timeout: 8,
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
  
  // БЫСТРЫЙ AI ответ
  const aiResponse = await getRepResponse(question, phone);
  
  // Логируем AI разговор
  logAIConversation(phone, question, aiResponse);
  
  twiml.say(aiResponse, { voice: 'alice', language: 'en-US' });
  
  const lowerQuestion = question.toLowerCase();
  
  // 🔥 ИСПРАВЛЕНИЕ: Если вопрос про appointments → ПЕРЕВОДИМ В APPOINTMENT FLOW
  if (lowerQuestion.includes('appointment') || 
      lowerQuestion.includes('book') || 
      lowerQuestion.includes('schedule') ||
      lowerQuestion.includes('meeting') ||
      lowerQuestion.includes('appoint')) {
    
    twiml.pause({ length: 0.5 });
    twiml.say("Transferring you to our booking system now.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/transfer-to-appointment');
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Если "bye", "thank you" → ВЕШАЕМ ТРУБКУ
  if (lowerQuestion.includes('bye') || 
      lowerQuestion.includes('thank you') || 
      lowerQuestion.includes('thanks') ||
      lowerQuestion.includes('goodbye') ||
      lowerQuestion.includes('that\'s all')) {
    
    twiml.say("Thank you for calling Altair Partners. Goodbye!", { voice: 'alice', language: 'en-US' });
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Обычный разговор
  const gather = twiml.gather({
    input: 'speech',
    action: '/process-rep-question',
    method: 'POST',
    speechTimeout: 2,
    timeout: 8
  });
  
  gather.say("What else can I help you with?", { voice: 'alice', language: 'en-US' });
  
  twiml.say("Or press any key to return to main menu.");
  twiml.redirect('/voice');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// CREATIVE DIRECTOR (Option 7)
// -------------------------------------------------------
app.post('/creative-director', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.body.From;
  
  console.log("🎨 Creative Director - asking for details");
  
  // Проверяем еще раз (на всякий случай)
  if (!isWithinBusinessHours()) {
    const nextOpenTime = getTimeUntilOpen();
    twiml.say(
      `I'm sorry, but we are currently closed. ${nextOpenTime}. ` +
      "Please call back during business hours. Goodbye.",
      { voice: 'alice', language: 'en-US' }
    );
    twiml.hangup();
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Логируем
  logCall(phone, 'CREATIVE_DIRECTOR_SELECTED');

  const gather = twiml.gather({
    input: 'speech',
    action: '/check-creative-question',
    method: 'POST',
    speechTimeout: 5,
    timeout: 15,
    speechModel: 'phone_call',
    enhanced: true
  });
  
  gather.say(
    "What exactly are you calling about? Maybe I can help you with that.",
    { voice: 'alice', language: 'en-US' }
  );
  
  twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
  twiml.redirect('/creative-director');
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/check-creative-question', (req, res) => {
  const twiml = new VoiceResponse();
  const question = req.body.SpeechResult || '';
  const phone = req.body.From;
  
  console.log(`🎨 Creative Director question: ${question}`);
  
  if (!question || question.trim() === '') {
    twiml.say("I didn't hear your question. Let's try again.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/creative-director');
    return res.type('text/xml').send(twiml.toString());
  }
  
  // Проверка серьезных вопросов
  if (isSeriousQuestion(question)) {
    console.log(`🚨 SERIOUS QUESTION detected: ${question}`);
    
    // Логируем серьезный вопрос
    logCall(phone, 'SERIOUS_QUESTION_DETECTED', {
      question,
      category: 'legal/money'
    });
    
    // ЗВОНИМ НА ТВОЙ НОМЕР (не говорим клиенту)
    try {
      twilioClient.calls.create({
        url: 'http://demo.twilio.com/docs/voice.xml',
        to: '+15035442571',
        from: process.env.TWILIO_PHONE_NUMBER
      });
      console.log(`📞 Calling creative director about serious matter: ${question}`);
    } catch (err) {
      console.log("ERROR calling director:", err);
    }
    
    twiml.say(
      "I understand this is important. Our creative director has been notified and will review your inquiry shortly. " +
      "Would you like to schedule an appointment to discuss this further?",
      { voice: 'alice', language: 'en-US' }
    );
    
    const gather = twiml.gather({
      input: 'speech dtmf',
      action: '/creative-appointment-check',
      method: 'POST',
      speechTimeout: 3,
      timeout: 8
    });
    
    gather.say("Say yes or no.", { voice: 'alice', language: 'en-US' });
    
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
    
  } else {
    // Обычный вопрос
    twiml.say(
      "Perfect! You talked about that. Would you like to schedule an appointment with us?",
      { voice: 'alice', language: 'en-US' }
    );
    
    const gather = twiml.gather({
      input: 'speech dtmf',
      action: '/creative-appointment-check',
      method: 'POST',
      speechTimeout: 3,
      timeout: 8
    });
    
    gather.say("Say yes or no.", { voice: 'alice', language: 'en-US' });
    
    twiml.say("Returning to main menu.");
    twiml.redirect('/voice');
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

app.post('/creative-appointment-check', (req, res) => {
  const twiml = new VoiceResponse();
  const response = req.body.SpeechResult || req.body.Digits || '';
  const lowerResponse = response.toLowerCase();
  
  if (lowerResponse.includes('yes') || lowerResponse === '1') {
    twiml.say("Great! Transferring you to our booking system.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/transfer-to-appointment');
  } else {
    twiml.say("Okay. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
  }
  
  res.type('text/xml');
  res.send(twiml.toString());
});

// -------------------------------------------------------
// APPOINTMENT FLOW
// -------------------------------------------------------
app.post('/get-name', (req, res) => {
  const twiml = new VoiceResponse();
  const phone = req.query.phone || req.body.From;
  
  console.log(`📝 Getting name for: ${phone}`);
  
  // Логируем начало appointment flow
  logCall(phone, 'APPOINTMENT_FLOW_STARTED');

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
  
  let cleanedTime = time.trim()
    .replace(/NPM/gi, 'PM')
    .replace(/MPM/gi, 'PM')
    .replace(/AMM/gi, 'AM')
    .replace(/B ?M/gi, 'PM')
    .replace(/A ?M/gi, 'AM')
    .replace(/P ?M/gi, 'PM')
    .replace(/\s+/g, ' ')
    .trim();
  
  if (!cleanedTime.toLowerCase().includes('pacific') && !cleanedTime.toLowerCase().includes('pt')) {
    cleanedTime = `${cleanedTime} Pacific Time`;
  }
  
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
  
  const appointmentSaved = addAppointment(name, phone, businessType, serviceType, date, cleanedTime);
  
  if (appointmentSaved) {
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
    
    try {
      twilioClient.messages.create({
        body: `📅 NEW APPOINTMENT\n` +
              `Name: ${name}\n` +
              `Phone: ${phone}\n` +
              `Date: ${date} at ${cleanedTime}\n` +
              `Business: ${businessType}\n` +
              `Service: ${serviceType}\n` +
              `⏰ Reminder: Will call ONE DAY BEFORE at 2 PM Pacific Time`,
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
    "for further communication with our creative director. We will also call you ONE DAY BEFORE " +
    "your appointment at 2 PM Pacific Time as a reminder. Thank you for choosing Altair Partners!",
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
  
  // Логируем callback request
  logCall(phone, 'CALLBACK_REQUESTED');

  twiml.say(
    "Your callback request has been submitted. We'll call you back as soon as possible. " +
    "Thank you for choosing Altair Partners. Goodbye.",
    { voice: 'alice', language: 'en-US' }
  );
  
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
  const phone = req.body.From;
  
  console.log("🤝 Partnership inquiry");
  
  // Логируем partnership inquiry
  logCall(phone, 'PARTNERSHIP_INQUIRY');

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
  
  // Логируем управление appointment
  logCall(phone, `APPOINTMENT_MANAGE_${digit}`);

  if (!digit) {
    twiml.say("No selection made. Returning to main menu.", { voice: 'alice', language: 'en-US' });
    twiml.redirect('/voice');
    return res.type('text/xml').send(twiml.toString());
  }

  if (digit === '1') {
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
// TEST REMINDER ENDPOINT (для тестирования)
// -------------------------------------------------------
app.post('/test-reminder', (req, res) => {
  const phone = req.body.phone || req.query.phone;
  
  if (!phone) {
    return res.status(400).json({ error: "Phone number required" });
  }
  
  console.log(`🔔 Manual test trigger for phone: ${phone}`);
  
  triggerTestReminder(phone);
  
  res.json({ 
    status: 'test_triggered', 
    phone, 
    message: 'Test reminder call initiated' 
  });
});

// -------------------------------------------------------
// BUSINESS HOURS ENDPOINT
// -------------------------------------------------------
app.get('/business-status', (req, res) => {
  const businessStatus = getBusinessStatus();
  
  res.json({
    isOpen: businessStatus.isOpen,
    currentTime: businessStatus.currentTime,
    nextOpenTime: businessStatus.nextOpenTime,
    businessHours: businessStatus.hours,
    location: businessStatus.location,
    message: businessStatus.isOpen ? 
      "We are currently open!" : 
      `We are currently closed. ${businessStatus.nextOpenTime}`
  });
});

// -------------------------------------------------------
// DEBUG ENDPOINTS
// -------------------------------------------------------
app.get('/health', (req, res) => {
  res.status(200).send('✅ IVR Server is running');
});

app.get('/debug', (req, res) => {
  const appointments = loadDB();
  const businessStatus = getBusinessStatus();
  
  // Загружаем логи
  let callLogs = [];
  let aiConversations = [];
  let reminderLogs = [];
  
  try {
    if (fs.existsSync(CALL_LOGS_PATH)) {
      const logsData = fs.readFileSync(CALL_LOGS_PATH, "utf8");
      callLogs = JSON.parse(logsData || '[]');
    }
    
    if (fs.existsSync(AI_CONVERSATIONS_PATH)) {
      const convData = fs.readFileSync(AI_CONVERSATIONS_PATH, "utf8");
      aiConversations = JSON.parse(convData || '[]');
    }
    
    if (fs.existsSync(REMINDERS_LOG)) {
      const remData = fs.readFileSync(REMINDERS_LOG, "utf8");
      reminderLogs = JSON.parse(remData || '[]');
    }
  } catch (error) {
    console.error("ERROR loading logs:", error);
  }
  
  res.json({
    status: 'running',
    businessStatus,
    appointments: {
      total: appointments.length,
      recent: appointments.slice(-10)
    },
    callLogs: {
      total: callLogs.length,
      recent: callLogs.slice(-20)
    },
    aiConversations: {
      total: aiConversations.length,
      recent: aiConversations.slice(-10)
    },
    reminderLogs: {
      total: reminderLogs.length,
      recent: reminderLogs.slice(-10)
    },
    nextAvailableDate: getNextAvailableDate(),
    reminderSystem: {
      schedule: 'ONE DAY BEFORE appointment at 2 PM Pacific Time',
      checkInterval: 'Every 5 minutes',
      testEndpoint: 'POST /test-reminder?phone=+1234567890'
    },
    businessHours: {
      open: businessStatus.isOpen,
      message: businessStatus.isOpen ? 'Open now' : `Closed - ${businessStatus.nextOpenTime}`
    }
  });
});

app.get('/logs', (req, res) => {
  try {
    let callLogs = [];
    if (fs.existsSync(CALL_LOGS_PATH)) {
      const logsData = fs.readFileSync(CALL_LOGS_PATH, "utf8");
      callLogs = JSON.parse(logsData || '[]');
    }
    
    res.json({
      total: callLogs.length,
      logs: callLogs.reverse(), // Новые сверху
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load logs" });
  }
});

app.get('/appointments', (req, res) => {
  const appointments = loadDB();
  
  res.json({
    total: appointments.length,
    appointments: appointments.reverse(), // Новые сверху
    lastUpdated: new Date().toISOString()
  });
});

app.get('/conversations', (req, res) => {
  try {
    let aiConversations = [];
    if (fs.existsSync(AI_CONVERSATIONS_PATH)) {
      const convData = fs.readFileSync(AI_CONVERSATIONS_PATH, "utf8");
      aiConversations = JSON.parse(convData || '[]');
    }
    
    res.json({
      total: aiConversations.length,
      conversations: aiConversations.reverse(), // Новые сверху
      lastUpdated: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load conversations" });
  }
});

app.get('/reminders', (req, res) => {
  try {
    let reminderLogs = [];
    if (fs.existsSync(REMINDERS_LOG)) {
      const remData = fs.readFileSync(REMINDERS_LOG, "utf8");
      reminderLogs = JSON.parse(remData || '[]');
    }
    
    res.json({
      total: reminderLogs.length,
      reminders: reminderLogs.reverse(), // Новые сверху
      lastUpdated: new Date().toISOString(),
      systemInfo: 'Calls ONE DAY BEFORE appointment at 2 PM Pacific Time'
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to load reminders" });
  }
});

// -------------------------------------------------------
// START SERVER WITH REMINDER SYSTEM
// -------------------------------------------------------
const PORT = process.env.PORT || 1337;
app.listen(PORT, () => {
  const businessStatus = getBusinessStatus();
  
  console.log(`✅ IVR Server running on port ${PORT}`);
  console.log(`⏰ Business Status: ${businessStatus.isOpen ? 'OPEN' : 'CLOSED'}`);
  console.log(`🕐 Current Time (PST): ${businessStatus.currentTime}`);
  console.log(`📅 Next Open: ${businessStatus.nextOpenTime}`);
  console.log(`✅ Health check: http://localhost:${PORT}/health`);
  console.log(`✅ Debug: http://localhost:${PORT}/debug`);
  console.log(`📊 Logs: http://localhost:${PORT}/logs`);
  console.log(`📅 Appointments: http://localhost:${PORT}/appointments`);
  console.log(`🤖 Conversations: http://localhost:${PORT}/conversations`);
  console.log(`⏰ Reminders: http://localhost:${PORT}/reminders`);
  console.log(`🏢 Business Status: http://localhost:${PORT}/business-status`);
  console.log(`✅ Next available date: ${getNextAvailableDate()}`);
  console.log(`🤖 AI Representative is ready (fast mode)`);
  console.log(`📝 Logging enabled: call_logs.json, ai_conversations.json, reminders_log.json`);
  console.log(`⏰ Reminder system: Calls ONE DAY BEFORE appointment at 2 PM Pacific Time`);
  console.log(`🔄 Check interval: Every 5 minutes`);
  console.log(`🔔 Test endpoint: POST http://localhost:${PORT}/test-reminder?phone=+1234567890`);
  console.log(`🚪 After-hours options: Callback request (1) or Voice message (2)`);
  
  // Запускаем reminder scheduler
  startReminderScheduler();
});