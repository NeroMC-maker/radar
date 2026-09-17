import type { IncomingLink, Notifier, OutgoingNotification, SendResult } from './types';

type TgResponse<T> = { ok: true; result: T } | { ok: false; error_code: number; description: string };

type TgUpdate = {
  update_id: number;
  message?: { text?: string; chat: { id: number; type: string; first_name?: string; username?: string } };
};

/** Estado persistente del offset de getUpdates (lo inyecta el worker). */
export type OffsetStore = { get(): Promise<number>; set(v: number): Promise<void> };

/**
 * Bot de Telegram (entrega REAL).
 * Usa long polling (getUpdates), así que no necesita URL pública para vincular teléfonos.
 * El token nunca sale del servidor.
 */
export class TelegramNotifier implements Notifier {
  readonly channel = 'telegram' as const;
  readonly live = true;
  private username: string | null = null;

  constructor(
    private readonly token: string,
    private readonly offsets: OffsetStore,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call<T>(method: string, body: Record<string, unknown>, timeoutMs = 15_000): Promise<TgResponse<T>> {
    const res = await this.fetchImpl(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return (await res.json()) as TgResponse<T>;
  }

  async send(msg: OutgoingNotification): Promise<SendResult> {
    const base = { chat_id: msg.address, text: msg.text, disable_web_page_preview: true };
    try {
      let r = await this.call<{ message_id: number }>(
        'sendMessage',
        msg.button ? { ...base, reply_markup: { inline_keyboard: [[{ text: msg.button.label, url: msg.button.url }]] } } : base,
      );
      // Telegram rechaza botones con URLs locales (http://192.168…): se reenvía con el enlace en el texto.
      if (!r.ok && msg.button && r.error_code === 400 && /url/i.test(r.description)) {
        r = await this.call('sendMessage', { ...base, text: `${msg.text}\n\n${msg.button.label}: ${msg.button.url}` });
      }
      if (r.ok) return { status: 'accepted', providerMessageId: String(r.result.message_id) };
      return {
        status: 'failed',
        error: `Telegram ${r.error_code}: ${r.description}`,
        retryable: r.error_code === 429 || r.error_code >= 500,
      };
    } catch (e) {
      return { status: 'failed', error: `Telegram no respondió: ${(e as Error).message}`, retryable: true };
    }
  }

  async botUsername(): Promise<string | null> {
    if (this.username) return this.username;
    try {
      const r = await this.call<{ username: string }>('getMe', {});
      if (r.ok) this.username = r.result.username;
    } catch {
      /* se reintenta en la próxima llamada */
    }
    return this.username;
  }

  async linkUrl(code: string): Promise<string | null> {
    const u = await this.botUsername();
    return u ? `https://t.me/${u}?start=${encodeURIComponent(code)}` : null;
  }

  async pollLinks(): Promise<IncomingLink[]> {
    const offset = await this.offsets.get();
    const r = await this.call<TgUpdate[]>(
      'getUpdates',
      { offset, timeout: 20, allowed_updates: ['message'] },
      30_000,
    );
    if (!r.ok) throw new Error(`Telegram getUpdates ${r.error_code}: ${r.description}`);
    const links: IncomingLink[] = [];
    let next = offset;
    for (const u of r.result) {
      next = Math.max(next, u.update_id + 1);
      const m = u.message;
      // Solo chats privados: un grupo no debe recibir propuestas de una marca.
      if (!m?.text || m.chat.type !== 'private') continue;
      const match = /^\/start\s+([A-Za-z0-9_-]{6,64})$/.exec(m.text.trim());
      if (match?.[1]) {
        links.push({
          code: match[1],
          address: String(m.chat.id),
          displayName: m.chat.first_name ?? m.chat.username ?? 'Telegram',
        });
      } else if (m.text.startsWith('/start')) {
        await this.confirmLink(
          String(m.chat.id),
          'Hola. Para recibir propuestas, abre Radar → Notificaciones y pulsa "Conectar Telegram".',
        );
      }
    }
    if (next !== offset) await this.offsets.set(next);
    return links;
  }

  async confirmLink(address: string, text: string): Promise<void> {
    await this.call('sendMessage', { chat_id: address, text });
  }
}
