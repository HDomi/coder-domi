/**
 * 사주 만세력 60갑자 일진 및 십성(十星) 계산 유틸리티
 */

export interface ElementYinYang {
  element: "Wood" | "Fire" | "Earth" | "Metal" | "Water";
  isYang: boolean; // true: +, false: -
}

export const CHEONGAN: { name: string; hanja: string; element: "Wood" | "Fire" | "Earth" | "Metal" | "Water"; isYang: boolean }[] = [
  { name: "갑", hanja: "甲", element: "Wood", isYang: true },
  { name: "을", hanja: "乙", element: "Wood", isYang: false },
  { name: "병", hanja: "丙", element: "Fire", isYang: true },
  { name: "정", hanja: "丁", element: "Fire", isYang: false },
  { name: "무", hanja: "戊", element: "Earth", isYang: true },
  { name: "기", hanja: "己", element: "Earth", isYang: false },
  { name: "경", hanja: "庚", element: "Metal", isYang: true },
  { name: "신", hanja: "辛", element: "Metal", isYang: false },
  { name: "임", hanja: "壬", element: "Water", isYang: true },
  { name: "계", hanja: "癸", element: "Water", isYang: false },
];

export const JIJI: { name: string; hanja: string; element: "Wood" | "Fire" | "Earth" | "Metal" | "Water"; isYang: boolean }[] = [
  { name: "자", hanja: "子", element: "Water", isYang: true },
  { name: "축", hanja: "丑", element: "Earth", isYang: false },
  { name: "인", hanja: "寅", element: "Wood", isYang: true },
  { name: "묘", hanja: "卯", element: "Wood", isYang: false },
  { name: "진", hanja: "辰", element: "Earth", isYang: true },
  { name: "사", hanja: "巳", element: "Fire", isYang: true },
  { name: "오", hanja: "午", element: "Fire", isYang: false },
  { name: "미", hanja: "未", element: "Earth", isYang: false },
  { name: "신", hanja: "申", element: "Metal", isYang: true },
  { name: "유", hanja: "酉", element: "Metal", isYang: false },
  { name: "술", hanja: "戌", element: "Earth", isYang: true },
  { name: "해", hanja: "亥", element: "Water", isYang: false },
];

// 기준일: 2026-07-27 (월요일) -> 丁丑 (정축) 일진 (60갑자 인덱스 13)
const ANCHOR_DATE_STR = "2026-07-27";
const ANCHOR_INDEX = 13;

export interface IljinInfo {
  dateStr: string;
  stem: string;
  stemHanja: string;
  branch: string;
  branchHanja: string;
  fullName: string; // 예: "정축(丁丑)"
  stemIdx: number;
  branchIdx: number;
}

/**
 * 주어진 날짜(YYYY-MM-DD)의 만세력 60갑자 일진을 계산합니다.
 */
export function getIljinForDate(dateStr: string): IljinInfo {
  const anchor = new Date(`${ANCHOR_DATE_STR}T00:00:00+09:00`);
  const target = new Date(`${dateStr}T00:00:00+09:00`);
  const diffDays = Math.round((target.getTime() - anchor.getTime()) / 86400000);

  let idx = (ANCHOR_INDEX + diffDays) % 60;
  if (idx < 0) idx = ((idx % 60) + 60) % 60;

  const stemIdx = idx % 10;
  const branchIdx = idx % 12;

  const c = CHEONGAN[stemIdx];
  const j = JIJI[branchIdx];

  return {
    dateStr,
    stem: c.name,
    stemHanja: c.hanja,
    branch: j.name,
    branchHanja: j.hanja,
    fullName: `${c.name}${j.name}(${c.hanja}${j.hanja})`,
    stemIdx,
    branchIdx,
  };
}

/**
 * 일간 문자열(예: "계수", "癸水", "계", "癸", "경금" 등)을 분석하여 천간 인덱스(0~9)를 반환합니다.
 */
export function parseIlganIndex(ilganStr?: string): number | null {
  if (!ilganStr) return null;
  const clean = ilganStr.trim();

  for (let i = 0; i < CHEONGAN.length; i++) {
    const c = CHEONGAN[i];
    if (
      clean.includes(c.name) ||
      clean.includes(c.hanja) ||
      clean.startsWith(c.name) ||
      clean.startsWith(c.hanja)
    ) {
      return i;
    }
  }
  return null;
}

/**
 * 상생상극 체계:
 * Wood -> Fire -> Earth -> Metal -> Water -> Wood (생)
 * Wood -> Earth -> Water -> Fire -> Metal -> Wood (극)
 */
const GENERATES: Record<string, string> = {
  Wood: "Fire",
  Fire: "Earth",
  Earth: "Metal",
  Metal: "Water",
  Water: "Wood",
};

const CONTROLS: Record<string, string> = {
  Wood: "Earth",
  Earth: "Water",
  Water: "Fire",
  Fire: "Metal",
  Metal: "Wood",
};

/**
 * 일간(Me)과 대상 요소(Other) 간의 십성(十星) 이름을 계산합니다.
 */
export function calculateSipseongName(
  me: { element: string; isYang: boolean },
  other: { element: string; isYang: boolean }
): string {
  const sameYinYang = me.isYang === other.isYang;

  // 1. 비겁 (동일 오행)
  if (me.element === other.element) {
    return sameYinYang ? "비견" : "겁재";
  }

  // 2. 식상 (내가 생함)
  if (GENERATES[me.element] === other.element) {
    return sameYinYang ? "식신" : "상관";
  }

  // 3. 재성 (내가 극함)
  if (CONTROLS[me.element] === other.element) {
    return sameYinYang ? "편재" : "정재";
  }

  // 4. 관성 (남이 나를 극함)
  if (CONTROLS[other.element] === me.element) {
    return sameYinYang ? "편관" : "정관";
  }

  // 5. 인성 (남이 나를 생함)
  if (GENERATES[other.element] === me.element) {
    return sameYinYang ? "편인" : "정인";
  }

  return "일반";
}

/**
 * 일간 인덱스(0~9)와 날짜의 일진(천간, 지지)을 바탕으로 [천간십성/지지십성] 문자열을 산출합니다.
 */
export function getSipseongForDay(dayIljin: IljinInfo, ilganIdx: number): string {
  const me = CHEONGAN[ilganIdx];
  const stemOther = CHEONGAN[dayIljin.stemIdx];
  const branchOther = JIJI[dayIljin.branchIdx];

  const stemSipseong = calculateSipseongName(me, stemOther);
  const branchSipseong = calculateSipseongName(me, branchOther);

  return `[${stemSipseong}/${branchSipseong}]`;
}
