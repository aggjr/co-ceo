/**
 * Business Days Utilities
 * Handles business day calculations excluding weekends and Brazilian national holidays
 */

/**
 * Calculate Easter Sunday for a given year using Meeus/Jones/Butcher algorithm
 */
const getEasterSunday = (year) => {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month - 1, day);
};

/**
 * Get Brazilian national holidays for a given year
 */
const getBrazilianHolidays = (year) => {
    const easter = getEasterSunday(year);

    // Fixed holidays
    const holidays = [
        new Date(year, 0, 1),   // New Year's Day
        new Date(year, 3, 21),  // Tiradentes' Day
        new Date(year, 4, 1),   // Labor Day
        new Date(year, 8, 7),   // Independence Day
        new Date(year, 9, 12),  // Our Lady of Aparecida
        new Date(year, 10, 2),  // All Souls' Day
        new Date(year, 10, 15), // Republic Day
        new Date(year, 10, 20), // Black Consciousness Day
        new Date(year, 11, 25)  // Christmas
    ];

    // Movable holidays based on Easter
    const carnival = new Date(easter);
    carnival.setDate(easter.getDate() - 47); // 47 days before Easter

    const goodFriday = new Date(easter);
    goodFriday.setDate(easter.getDate() - 2); // 2 days before Easter

    const corpusChristi = new Date(easter);
    corpusChristi.setDate(easter.getDate() + 60); // 60 days after Easter

    holidays.push(carnival, goodFriday, corpusChristi);

    return holidays;
};

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
const isWeekend = (date) => {
    const day = date.getDay();
    return day === 0 || day === 6; // 0 = Sunday, 6 = Saturday
};

/**
 * Check if a date is a Brazilian national holiday
 */
const isHoliday = (date, holidays) => {
    const dateStr = date.toISOString().split('T')[0];
    return holidays.some(holiday => {
        const holidayStr = holiday.toISOString().split('T')[0];
        return dateStr === holidayStr;
    });
};

/**
 * Check if a date is a business day (not weekend and not holiday)
 */
const isBusinessDay = (date) => {
    const year = date.getFullYear();
    const holidays = getBrazilianHolidays(year);
    return !isWeekend(date) && !isHoliday(date, holidays);
};

/**
 * Add N business days to a date
 */
const addBusinessDays = (startDate, days) => {
    let currentDate = new Date(startDate);
    let addedDays = 0;

    while (addedDays < days) {
        currentDate.setDate(currentDate.getDate() + 1);
        if (isBusinessDay(currentDate)) {
            addedDays++;
        }
    }

    return currentDate;
};

/**
 * Calculate the number of business days between two dates
 * Returns positive number if date2 is after date1, negative if before
 */
const getBusinessDaysDifference = (date1, date2) => {
    const start = new Date(date1);
    const end = new Date(date2);

    // Normalize to start of day
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    // If same date, return 0
    if (start.getTime() === end.getTime()) {
        return 0;
    }

    // Determine direction
    const isForward = end > start;
    let current = new Date(isForward ? start : end);
    const target = new Date(isForward ? end : start);
    let businessDays = 0;

    // Count business days
    while (current < target) {
        current.setDate(current.getDate() + 1);
        if (isBusinessDay(current)) {
            businessDays++;
        }
    }

    return isForward ? businessDays : -businessDays;
};

module.exports = {
    getBrazilianHolidays,
    isWeekend,
    isHoliday,
    isBusinessDay,
    addBusinessDays,
    getBusinessDaysDifference
};

