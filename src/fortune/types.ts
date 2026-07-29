import { FortuneUserInfo } from "../firebase";

export interface DayFortune {
  dayName: string; // e.g. "월요일"
  dateStr: string; // e.g. "2026-07-27"
  content: string; // Detailed fortune markdown text for this day
}

export interface WeeklyFortuneResult {
  weekTitle: string; // e.g. "2026년 7월 27일(월) ~ 8월 2일(일) 주간 운세"
  days: DayFortune[]; // Array of 7 items (Mon ~ Sun)
  userInfo: FortuneUserInfo;
}

export interface TodayFortuneResult {
  dateStr: string; // e.g. "2026-07-29"
  dayName: string; // e.g. "수요일"
  content: string; // Detailed today's fortune markdown text
  userInfo: FortuneUserInfo;
}
