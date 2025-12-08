// -------------------------------------------------------
// WORKING HOURS CHECK FUNCTIONS
// -------------------------------------------------------

// Проверяем, находимся ли мы в рабочее время
function isWithinBusinessHours() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    const hour = pstTime.getHours();
    const minutes = pstTime.getMinutes();
    const currentTime = hour * 100 + minutes; // Преобразуем в число для сравнения
    
    // Рабочие часы: Пн-Пт, 10:00-17:00 (10 AM - 5 PM) Pacific Time
    const isWeekday = day >= 1 && day <= 5; // Понедельник-Пятница
    const isWithinHours = currentTime >= 1000 && currentTime <= 1700; // 10:00 - 17:00
    
    console.log(`⏰ Time check: Day ${day}, Time ${hour}:${minutes}, Weekday: ${isWeekday}, Within hours: ${isWithinHours}`);
    
    return isWeekday && isWithinHours;
    
  } catch (error) {
    console.error("Error checking business hours:", error);
    return true; // В случае ошибки считаем что открыто
  }
}

// Получить время до открытия
function getTimeUntilOpen() {
  try {
    const now = new Date();
    const pstTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    
    const day = pstTime.getDay();
    const hour = pstTime.getHours();
    const minutes = pstTime.getMinutes();
    
    let daysUntilOpen = 0;
    let openingHour = 10; // 10 AM
    
    if (day === 0) { // Воскресенье
      daysUntilOpen = 1; // Откроемся в понедельник
    } else if (day === 6) { // Суббота
      daysUntilOpen = 2; // Откроемся в понедельник
    } else if (day >= 1 && day <= 5) { // Пн-Пт
      if (hour < 10) {
        // Сегодня откроемся в 10 AM
        daysUntilOpen = 0;
      } else if (hour >= 17) {
        // Уже после 5 PM
        if (day === 5) { // Пятница
          daysUntilOpen = 3; // Откроемся в понедельник
        } else {
          daysUntilOpen = 1; // Откроемся завтра
        }
      }
    }
    
    let message = "";
    if (daysUntilOpen === 0) {
      const hoursUntilOpen = 10 - hour;
      if (hoursUntilOpen > 0) {
        message = `We open today at ${openingHour} AM Pacific Time`;
      } else {
        message = `We're open now until 5 PM Pacific Time`;
      }
    } else if (daysUntilOpen === 1) {
      message = `We open tomorrow at ${openingHour} AM Pacific Time`;
    } else {
      message = `We open on Monday at ${openingHour} AM Pacific Time`;
    }
    
    return message;
    
  } catch (error) {
    console.error("Error calculating time until open:", error);
    return "We open tomorrow at 10 AM Pacific Time";
  }
}

// Получить статус работы для логов
function getBusinessStatus() {
  const isOpen = isWithinBusinessHours();
  const nextOpenTime = getTimeUntilOpen();
  
  return {
    isOpen,
    nextOpenTime,
    currentTime: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
    hours: "Monday to Friday, 10 AM to 5 PM Pacific Time",
    location: "Portland, Oregon"
  };
}

module.exports = {
  isWithinBusinessHours,
  getTimeUntilOpen,
  getBusinessStatus
};