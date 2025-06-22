export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    throw new Error('Invalid email format');
  }
  return true;
}

export function validatePassword(password: string): boolean {
  if (password.length < 8) {
    throw new Error('Password must be at least 8 characters long');
  }
  if (!/(?=.*[a-z])/.test(password)) {
    throw new Error('Password must contain at least one lowercase letter');
  }
  if (!/(?=.*[A-Z])/.test(password)) {
    throw new Error('Password must contain at least one uppercase letter');
  }
  if (!/(?=.*\d)/.test(password)) {
    throw new Error('Password must contain at least one number');
  }
  return true;
}

export function validateName(name: string): boolean {
  if (name.length < 2) {
    throw new Error('Name must be at least 2 characters long');
  }
  if (name.length > 50) {
    throw new Error('Name must be less than 50 characters');
  }
  if (!/^[a-zA-Z\s]+$/.test(name)) {
    throw new Error('Name can only contain letters and spaces');
  }
  return true;
}

