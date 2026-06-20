import bcrypt from "bcryptjs";

const passwordRounds = 12;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, passwordRounds);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}
