export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export interface PasswordCriteria {
  length: boolean;
  letter: boolean;
  number: boolean;
  special: boolean;
}

export function evaluatePassword(password: string): PasswordCriteria {
  return {
    length:
      password.length >= PASSWORD_MIN_LENGTH &&
      password.length <= PASSWORD_MAX_LENGTH,
    letter: /[A-Za-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[^A-Za-z0-9\s]/.test(password),
  };
}

export function isStrongPassword(password: string) {
  return Object.values(evaluatePassword(password)).every(Boolean);
}
