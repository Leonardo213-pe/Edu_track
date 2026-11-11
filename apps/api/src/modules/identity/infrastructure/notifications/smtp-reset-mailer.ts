import { createTransport } from 'nodemailer';
import type { ResetMailer, ResetMessage } from '../../application/ports';
export interface MailConfig { host: string; port: number; from: string; secure: boolean; requireTLS: boolean; user?: string; password?: string; webOrigin: string }
export class SmtpResetMailer implements ResetMailer {
  private readonly transport;
  constructor(private readonly config: MailConfig) {
    this.transport = createTransport({ host: config.host, port: config.port, secure: config.secure, requireTLS: config.requireTLS,
      auth: config.user ? { user: config.user, pass: config.password } : undefined,
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
      tls: { minVersion: 'TLSv1.2' }, logger: false, debug: false });
  }
  async send(message: ResetMessage): Promise<void> {
    const url = `${this.config.webOrigin}/#reset=${message.token}`;
    const result = await this.transport.sendMail({ from: this.config.from, to: message.email, subject: 'Recupera tu acceso a EduTrack',
      text: `Abre este enlace para elegir una nueva contraseña:\n${url}\n\nVence a las ${message.expiresAt} (UTC). Solo puede usarse una vez.\nSi no solicitaste el cambio, ignora este mensaje.` });
    if (!result.accepted?.length) throw new Error('SMTP recipient rejected');
  }
}
