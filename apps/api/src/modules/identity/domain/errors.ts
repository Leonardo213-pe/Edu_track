export class IdentityError extends Error {
  constructor(public readonly code: 'INVALID_INPUT' | 'INVALID_CREDENTIALS' | 'FORBIDDEN' | 'EMAIL_EXISTS') {
    super(code); this.name = 'IdentityError';
  }
}
