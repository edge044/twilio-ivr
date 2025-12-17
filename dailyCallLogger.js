const fs = require('fs');
const path = require('path');

// Папка для ежедневных логов
const DAILY_LOGS_DIR = "./daily_logs";

// Создаем папку если её нет
if (!fs.existsSync(DAILY_LOGS_DIR)) {
  fs.mkdirSync(DAILY_LOGS_DIR);
}

// Получить текущую дату в формате YYYY-MM-DD
function getCurrentDate() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Получить дату в красивом формате для отображения
function getFormattedDate() {
  const now = new Date();
  const options = { 
    weekday: 'long', 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric',
    timeZone: 'America/Los_Angeles'
  };
  return now.toLocaleDateString('en-US', options);
}

// Получить время в PST
function getPSTTime() {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    timeZone: 'America/Los_Angeles',
    hour12: true,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

// Получить путь к файлу лога за сегодня
function getTodayLogPath() {
  const date = getCurrentDate();
  return path.join(DAILY_LOGS_DIR, `${date}.json`);
}

// Получить путь к файлу лога за определенную дату
function getLogPathForDate(dateString) {
  return path.join(DAILY_LOGS_DIR, `${dateString}.json`);
}

// Загрузить лог за сегодня или создать новый
function loadTodayLog() {
  const logPath = getTodayLogPath();
  
  try {
    if (fs.existsSync(logPath)) {
      const data = fs.readFileSync(logPath, 'utf8');
      return JSON.parse(data || '{}');
    }
  } catch (error) {
    console.error("Error loading daily log:", error);
  }
  
  // Создаем новый лог для сегодня
  return {
    date: getCurrentDate(),
    formattedDate: getFormattedDate(),
    totalCalls: 0,
    appointmentsMade: 0,
    callbackRequests: 0,
    representativeCalls: 0,
    creativeDirectorCalls: 0,
    partnershipInquiries: 0,
    afterHoursCalls: 0,
    voiceMessages: 0,
    seriousQuestions: 0,
    calls: []
  };
}

// Сохранить лог за сегодня
function saveTodayLog(logData) {
  const logPath = getTodayLogPath();
  
  try {
    fs.writeFileSync(logPath, JSON.stringify(logData, null, 2));
    console.log(`📊 Daily log saved: ${logPath}`);
  } catch (error) {
    console.error("Error saving daily log:", error);
  }
}

// Записать звонок в дневной лог
function logDailyCall(phone, action, details = {}) {
  const todayLog = loadTodayLog();
  
  // Обновляем статистику
  todayLog.totalCalls = (todayLog.totalCalls || 0) + 1;
  
  // Обновляем счетчики по типам действий
  switch(action) {
    case 'APPOINTMENT_SCHEDULED':
      todayLog.appointmentsMade = (todayLog.appointmentsMade || 0) + 1;
      break;
    case 'CALLBACK_REQUESTED':
    case 'AFTER_HOURS_CALLBACK_REQUESTED':
      todayLog.callbackRequests = (todayLog.callbackRequests || 0) + 1;
      break;
    case 'REPRESENTATIVE_SELECTED':
      todayLog.representativeCalls = (todayLog.representativeCalls || 0) + 1;
      break;
    case 'CREATIVE_DIRECTOR_SELECTED':
      todayLog.creativeDirectorCalls = (todayLog.creativeDirectorCalls || 0) + 1;
      break;
    case 'PARTNERSHIP_INQUIRY':
      todayLog.partnershipInquiries = (todayLog.partnershipInquiries || 0) + 1;
      break;
    case 'VOICE_MESSAGE_RECORDED':
      todayLog.voiceMessages = (todayLog.voiceMessages || 0) + 1;
      break;
    case 'SERIOUS_QUESTION_DETECTED':
      todayLog.seriousQuestions = (todayLog.seriousQuestions || 0) + 1;
      break;
    case 'CALL_RECEIVED':
      // Проверяем нерабочее время
      if (!details.isWithinBusinessHours) {
        todayLog.afterHoursCalls = (todayLog.afterHoursCalls || 0) + 1;
      }
      break;
  }
  
  // Добавляем детали звонка
  const callRecord = {
    phone,
    action,
    details,
    timestamp: new Date().toISOString(),
    timePST: getPSTTime(),
    date: getCurrentDate(),
    formattedDate: getFormattedDate()
  };
  
  todayLog.calls = todayLog.calls || [];
  todayLog.calls.push(callRecord);
  
  // Сохраняем только последние 500 звонков за день
  if (todayLog.calls.length > 500) {
    todayLog.calls = todayLog.calls.slice(-500);
  }
  
  saveTodayLog(todayLog);
  
  return callRecord;
}

// Получить статистику за сегодня
function getTodayStats() {
  const todayLog = loadTodayLog();
  return {
    date: todayLog.formattedDate,
    totalCalls: todayLog.totalCalls || 0,
    appointmentsMade: todayLog.appointmentsMade || 0,
    callbackRequests: todayLog.callbackRequests || 0,
    representativeCalls: todayLog.representativeCalls || 0,
    creativeDirectorCalls: todayLog.creativeDirectorCalls || 0,
    partnershipInquiries: todayLog.partnershipInquiries || 0,
    afterHoursCalls: todayLog.afterHoursCalls || 0,
    voiceMessages: todayLog.voiceMessages || 0,
    seriousQuestions: todayLog.seriousQuestions || 0
  };
}

// Получить все даты с логами
function getAllLogDates() {
  try {
    if (!fs.existsSync(DAILY_LOGS_DIR)) {
      return [];
    }
    
    const files = fs.readdirSync(DAILY_LOGS_DIR);
    const dates = files
      .filter(file => file.endsWith('.json'))
      .map(file => file.replace('.json', ''))
      .sort((a, b) => b.localeCompare(a)); // Сортировка по убыванию (новые сверху)
    
    return dates;
  } catch (error) {
    console.error("Error getting log dates:", error);
    return [];
  }
}

// Получить лог за определенную дату
function getLogForDate(dateString) {
  const logPath = getLogPathForDate(dateString);
  
  try {
    if (fs.existsSync(logPath)) {
      const data = fs.readFileSync(logPath, 'utf8');
      return JSON.parse(data || '{}');
    }
  } catch (error) {
    console.error(`Error loading log for date ${dateString}:`, error);
  }
  
  return null;
}

// Получить статистику за период
function getStatsForPeriod(startDate, endDate) {
  const dates = getAllLogDates();
  const periodDates = dates.filter(date => date >= startDate && date <= endDate);
  
  const stats = {
    startDate,
    endDate,
    totalDays: periodDates.length,
    totalCalls: 0,
    appointmentsMade: 0,
    callbackRequests: 0,
    representativeCalls: 0,
    creativeDirectorCalls: 0,
    partnershipInquiries: 0,
    afterHoursCalls: 0,
    voiceMessages: 0,
    seriousQuestions: 0,
    dailyLogs: []
  };
  
  for (const date of periodDates) {
    const log = getLogForDate(date);
    if (log) {
      stats.totalCalls += log.totalCalls || 0;
      stats.appointmentsMade += log.appointmentsMade || 0;
      stats.callbackRequests += log.callbackRequests || 0;
      stats.representativeCalls += log.representativeCalls || 0;
      stats.creativeDirectorCalls += log.creativeDirectorCalls || 0;
      stats.partnershipInquiries += log.partnershipInquiries || 0;
      stats.afterHoursCalls += log.afterHoursCalls || 0;
      stats.voiceMessages += log.voiceMessages || 0;
      stats.seriousQuestions += log.seriousQuestions || 0;
      
      stats.dailyLogs.push({
        date: log.formattedDate || date,
        totalCalls: log.totalCalls || 0,
        appointmentsMade: log.appointmentsMade || 0,
        callbackRequests: log.callbackRequests || 0
      });
    }
  }
  
  return stats;
}

// Экспорт функций
module.exports = {
  logDailyCall,
  getTodayStats,
  getAllLogDates,
  getLogForDate,
  getStatsForPeriod,
  getCurrentDate,
  getFormattedDate
};