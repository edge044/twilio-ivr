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

// Парсим дату из строки (например: "Monday, December 10, 2024")
function parseAppointmentDate(dateStr) {
  try {
    // Убираем день недели если есть
    let cleanDateStr = dateStr;
    if (dateStr.includes(',')) {
      const parts = dateStr.split(',');
      if (parts.length > 2) {
        // Убираем день недели (первый элемент)
        cleanDateStr = parts.slice(1).join(',').trim();
      }
    }
    
    // Парсим дату
    const date = new Date(cleanDateStr);
    if (isNaN(date.getTime())) {
      // Пробуем другой формат
      const alternativeDate = new Date(cleanDateStr.replace(/(\d+)(st|nd|rd|th)/, '$1'));
      return isNaN(alternativeDate.getTime()) ? null : alternativeDate;
    }
    return date;
  } catch (error) {
    console.error("Error parsing date:", dateStr, error);
    return null;
  }
}

// Вычисляем день до appointment в 2 PM Pacific Time
function calculateReminderTime(appointmentDateStr) {
  try {
    const appointmentDate = parseAppointmentDate(appointmentDateStr);
    if (!appointmentDate) {
      console.error(`Cannot parse appointment date: ${appointmentDateStr}`);
      return null;
    }
    
    // Назначаем время appointment (предполагаем 2 PM если не указано)
    appointmentDate.setHours(14, 0, 0, 0); // 2 PM
    
    // Вычитаем 1 день для reminder
    const reminderDate = new Date(appointmentDate);
    reminderDate.setDate(reminderDate.getDate() - 1);
    
    // Устанавливаем время reminder на 2 PM Pacific Time
    reminderDate.setHours(14, 0, 0, 0);
    
    // Учитываем Pacific Time (устанавливаем часовой пояс)
    const pstOffset = -8 * 60 * 60 * 1000; // PST offset in milliseconds
    const pstDate = new Date(reminderDate.getTime() + pstOffset);
    
    console.log(`📅 Appointment: ${appointmentDateStr}`);
    console.log(`⏰ Reminder scheduled for: ${pstDate.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`);
    
    return pstDate;
  } catch (error) {
    console.error("Error calculating reminder time:", error);
    return null;
  }
}

// Проверить и позвонить для reminder'ов
async function checkAndCallReminders() {
  console.log("⏰ Checking for reminders to call...");
  console.log(`Current time: ${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`);
  
  const appointments = loadAppointments();
  const now = new Date();
  
  for (const appointment of appointments) {
    try {
      const reminderTime = calculateReminderTime(appointment.date);
      
      if (!reminderTime) {
        console.log(`⚠️ Could not calculate reminder time for: ${appointment.date}`);
        continue;
      }
      
      // Проверяем если сейчас время для reminder (с допуском ±5 минут)
      const timeDiff = now.getTime() - reminderTime.getTime();
      const fiveMinutes = 5 * 60 * 1000;
      
      if (Math.abs(timeDiff) < fiveMinutes) {
        // Проверить не звонили ли уже
        let alreadyCalled = false;
        if (fs.existsSync(REMINDERS_LOG)) {
          const logsData = fs.readFileSync(REMINDERS_LOG, "utf8");
          const logs = JSON.parse(logsData || '[]');
          alreadyCalled = logs.some(log => 
            log.phone === appointment.phone && 
            log.appointment.date === appointment.date &&
            log.status === 'CALL_INITIATED'
          );
        }
        
        if (!alreadyCalled) {
          console.log(`📞 Calling reminder for: ${appointment.name} - ${appointment.phone}`);
          console.log(`📅 Appointment: ${appointment.date} at ${appointment.time}`);
          console.log(`⏰ Reminder scheduled: ${reminderTime.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })} PST`);
          
          // Звоним
          const call = await twilioClient.calls.create({
            twiml: `
              <Response>
                <Say voice="alice" language="en-US">
                  Hello, this is Altair Partners calling to remind you about your appointment 
                  scheduled for ${appointment.date} at ${appointment.time}. 
                  Please call us if you need to reschedule.
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
      } else if (timeDiff > 0 && timeDiff < (24 * 60 * 60 * 1000)) {
        // Если время прошло, но меньше 24 часов назад
        console.log(`⏳ Reminder time passed for ${appointment.phone}: ${Math.round(timeDiff/60000)} minutes ago`);
      }
      
    } catch (error) {
      console.error(`❌ Error calling reminder for ${appointment.phone}:`, error);
      logReminder(appointment.phone, appointment, `ERROR: ${error.message}`);
    }
  }
  
  console.log("✅ Reminder check completed");
}

// Запустить проверку каждые 5 минут
function startReminderScheduler() {
  console.log("⏰ Reminder scheduler started (checking every 5 minutes)");
  console.log("📅 Reminders will call ONE DAY BEFORE appointment at 2 PM Pacific Time");
  
  // Первая проверка сразу
  checkAndCallReminders();
  
  // Потом каждые 5 минут
  setInterval(checkAndCallReminders, 5 * 60 * 1000);
}

// Ручной триггер для тестирования
function triggerTestReminder(phone) {
  console.log(`🔔 Manual test trigger for phone: ${phone}`);
  
  const appointments = loadAppointments();
  const appointment = appointments.find(a => a.phone === phone);
  
  if (appointment) {
    console.log(`📞 Test calling reminder for: ${appointment.name} - ${appointment.phone}`);
    
    // Звоним сразу для теста
    twilioClient.calls.create({
      twiml: `
        <Response>
          <Say voice="alice" language="en-US">
            Hello, this is a TEST reminder from Altair Partners.
            Your appointment is scheduled for ${appointment.date} at ${appointment.time}. 
            This is a test call. Thank you for choosing Altair Partners!
          </Say>
        </Response>
      `,
      to: appointment.phone,
      from: process.env.TWILIO_PHONE_NUMBER
    }).then(call => {
      console.log(`✅ Test reminder call initiated: ${call.sid}`);
      logReminder(appointment.phone, appointment, 'TEST_CALL_INITIATED');
    }).catch(error => {
      console.error(`❌ Test call error:`, error);
    });
    
  } else {
    console.log(`❌ No appointment found for phone: ${phone}`);
  }
}

// Экспорт функций
module.exports = {
  startReminderScheduler,
  checkAndCallReminders,
  triggerTestReminder
};