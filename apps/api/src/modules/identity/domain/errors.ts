export class IdentityError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'EMAIL_EXISTS' | 'NOT_FOUND' | 'CONFLICT' | 'LAST_ADMIN' | 'INVALID_RESET' | 'PASSWORD_MISMATCH') {
    super(code); this.name = 'IdentityError';
  }
}
