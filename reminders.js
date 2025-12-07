const fs = require('fs');
const twilioClient = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const DB_PATH = "./appointments.json";
const REMINDERS_LOG = "./reminders_log.json";

// Загрузить appointments
function loadAppointments() {
  try {
    if (!fs.existsSync(DB_PATH)) {
      return [];
    }
    const data = fs.readFileSync(DB_PATH, "utf8");
    return JSON.parse(data || '[]');
  } catch (error) {
    console.error("ERROR loading appointments:", error);
    return [];
  }
}

// Логировать reminder
function logReminder(phone, appointment, status) {
  try {
    let logs = [];
    if (fs.existsSync(REMINDERS_LOG)) {
      const data = fs.readFileSync(REMINDERS_LOG, "utf8");
      logs = JSON.parse(data || '[]');
    }
    
    logs.push({
      phone,
      appointment,
      status,
      timestamp: new Date().toISOString(),
      localTime: new Date().toLocaleString('en-US', {
        timeZone: 'America/Los_Angeles',
        hour12: true
      })
    });
    
    fs.writeFileSync(REMINDERS_LOG, JSON.stringify(logs, null, 2));
    console.log(`📅 Reminder logged: ${phone} - ${status}`);
    
  } catch (error) {
    console.error("ERROR logging reminder:", error);
  }
}

// Проверить и позвонить для reminder'ов
async function checkAndCallReminders() {
  console.log("⏰ Checking for reminders to call...");
  
  const appointments = loadAppointments();
  const now = new Date();
  
  for (const appointment of appointments) {
    try {
      const appointmentTime = new Date(appointment.created);
      const twoMinutesLater = new Date(appointmentTime.getTime() + 2 * 60 * 1000); // +2 минуты
      
      // Если сейчас больше чем 2 минуты после создания appointment
      if (now > twoMinutesLater) {
        // Проверить не звонили ли уже
        let alreadyCalled = false;
        if (fs.existsSync(REMINDERS_LOG)) {
          const logsData = fs.readFileSync(REMINDERS_LOG, "utf8");
          const logs = JSON.parse(logsData || '[]');
          alreadyCalled = logs.some(log => 
            log.phone === appointment.phone && 
            log.appointment.date === appointment.date
          );
        }
        
        if (!alreadyCalled) {
          console.log(`📞 Calling reminder for: ${appointment.name} - ${appointment.phone}`);
          
          // Звоним
          const call = await twilioClient.calls.create({
            twiml: `
              <Response>
                <Say voice="alice" language="en-US">
                  Hello, this is Altair Partners calling to remind you about your appointment 
                  scheduled for ${appointment.date} at ${appointment.time}. 
                  Thank you for choosing Altair Partners!
                </Say>
              </Response>
            `,
            to: appointment.phone,
            from: process.env.TWILIO_PHONE_NUMBER
          });
          
          console.log(`✅ Reminder call initiated: ${call.sid}`);
          logReminder(appointment.phone, appointment, 'CALL_INITIATED');
          
        } else {
          console.log(`⚠️ Already called reminder for: ${appointment.phone}`);
        }
      }
      
    } catch (error) {
      console.error(`❌ Error calling reminder for ${appointment.phone}:`, error);
      logReminder(appointment.phone, appointment, `ERROR: ${error.message}`);
    }
  }
  
  console.log("✅ Reminder check completed");
}

// Запустить проверку раз в минуту
function startReminderScheduler() {
  console.log("⏰ Reminder scheduler started (checking every 1 minute)");
  
  // Первая проверка сразу
  checkAndCallReminders();
  
  // Потом каждую минуту
  setInterval(checkAndCallReminders, 60 * 1000);
}

// Экспорт функций
module.exports = {
  startReminderScheduler,
  checkAndCallReminders
};