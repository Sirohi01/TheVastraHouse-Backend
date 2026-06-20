export function validateHsnCode(value: string): boolean {
  return /^\d{4,8}$/.test(value);
}

export function validateGstRate(value: number): boolean {
  return [0, 0.25, 3, 5, 12, 18, 28].includes(value);
}
