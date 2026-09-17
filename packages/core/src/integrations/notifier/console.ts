import { randomUUID } from 'node:crypto';
import type { IncomingLink, Notifier, OutgoingNotification, SendResult } from './types';

/**
 * Notificador SIMULADO: no llega a ningún teléfono.
 * Se usa cuando falta TELEGRAM_BOT_TOKEN y en las pruebas.
 */
export class ConsoleNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  readonly live = false;
  readonly sent: OutgoingNotification[] = [];
  private pendingLinks: IncomingLink[] = [];

  constructor(private readonly log: (line: string) => void = console.log) {}

  async send(msg: OutgoingNotification): Promise<SendResult> {
    this.sent.push(msg);
    this.log(`[notificación SIMULADA → ${msg.address}] ${msg.text}${msg.button ? ` (${msg.button.url})` : ''}`);
    return { status: 'accepted', providerMessageId: `sim-${randomUUID()}` };
  }

  async linkUrl(): Promise<string | null> {
    return null;
  }

  /** Solo para pruebas y modo simulado: vincula como si el usuario hubiera escrito al bot. */
  simulateLink(link: IncomingLink) {
    this.pendingLinks.push(link);
  }

  async pollLinks(): Promise<IncomingLink[]> {
    const out = this.pendingLinks;
    this.pendingLinks = [];
    return out;
  }

  async confirmLink(address: string, text: string): Promise<void> {
    this.log(`[notificación SIMULADA → ${address}] ${text}`);
  }
}
