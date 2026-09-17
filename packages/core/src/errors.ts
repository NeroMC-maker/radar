export type AppErrorCode = 'unauthenticated' | 'forbidden' | 'not_found' | 'conflict' | 'invalid' | 'budget_exceeded';

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const forbidden = (msg = 'No tienes permiso para esta acción') => new AppError('forbidden', msg);
export const notFound = (msg = 'No encontrado') => new AppError('not_found', msg);
export const conflict = (msg: string) => new AppError('conflict', msg);
export const invalid = (msg: string) => new AppError('invalid', msg);
