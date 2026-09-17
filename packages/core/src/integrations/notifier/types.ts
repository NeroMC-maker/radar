export type OutgoingNotification = {
  /** Dirección del destinatario en el proveedor (chat_id en Telegram) */
  address: string;
  /** Texto breve: puede verse en la pantalla bloqueada */
  text: string;
  button?: { label: string; url: string };
};

export type SendResult =
  /** accepted: el proveedor aceptó el mensaje. No implica que se haya leído. */
  | { status: 'accepted'; providerMessageId: string }
  | { status: 'failed'; error: string; retryable: boolean };

export type IncomingLink = { code: string; address: string; displayName: string };

export interface Notifier {
  readonly channel: 'telegram';
  /** true = entrega real; false = simulada (solo se registra en consola) */
  readonly live: boolean;
  send(msg: OutgoingNotification): Promise<SendResult>;
  /** Enlace que el usuario abre para vincular su teléfono con un código */
  linkUrl(code: string): Promise<string | null>;
  /** Recoge solicitudes de vinculación pendientes (/start <código>) */
  pollLinks(): Promise<IncomingLink[]>;
  confirmLink(address: string, text: string): Promise<void>;
}
