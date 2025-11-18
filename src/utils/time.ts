export const getCurrentTime_s = () => {
  return Math.floor(Date.now() / 1000);
};

export const sleep_s = async (s: number) => {
  return new Promise((resolve) => setTimeout(resolve, s * 1000));
};

export const MINUTE_s = 60;
export const HOUR_s = 60 * MINUTE_s;
export const DAY_s = 24 * HOUR_s;
export const WEEK_s = 7 * DAY_s;
export const YEAR_s = 365 * DAY_s;
