export type JulianDateResult = { year: number; day: number; date: string };

/** Centralized YDDD mapping: digit 0-9 resolves to years 2020-2029. */
export function julianDateFromBatch(batchCode: string | null | undefined): JulianDateResult | null {
  if (!batchCode) return null;
  const digits = batchCode.match(/\d/g)?.join("") ?? "";
  if (digits.length < 4) return null;
  const yearDigit = Number(digits[0]);
  const julianDay = Number(digits.slice(1, 4));
  if (yearDigit < 0 || yearDigit > 9 || julianDay < 1 || julianDay > 366) return null;

  const year = 2020 + yearDigit;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  if (julianDay > (leap ? 366 : 365)) return null;

  const date = new Date(Date.UTC(year, 0, julianDay)).toISOString().slice(0, 10);
  return { year, day: julianDay, date };
}
