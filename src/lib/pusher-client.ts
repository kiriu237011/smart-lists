import PusherJS from "pusher-js";

let _pusherClient: PusherJS | null = null;

/**
 * Возвращает синглтон Pusher-клиента.
 * Ленивая инициализация защищает от вызова в SSR-контексте (нет window).
 */
export function getPusherClient(): PusherJS {
  if (typeof window === "undefined") {
    throw new Error("getPusherClient вызван вне браузерного контекста");
  }
  if (!_pusherClient) {
    _pusherClient = new PusherJS(process.env.NEXT_PUBLIC_PUSHER_KEY!, {
      cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER!,
      // Auth endpoint для private-каналов — верифицирует подписку на сервере
      authEndpoint: "/api/pusher/auth",
    });
  }
  return _pusherClient;
}

/**
 * Возвращает socket_id текущего Pusher-соединения (или null, если не подключены).
 *
 * Передаётся в Server Actions, чтобы сервер исключил ЭТУ вкладку из Pusher-рассылки:
 * автор действия получает свежие данные вместе с ответом action (revalidatePath),
 * и дублирующий refresh через Pusher ему не нужен. Другие вкладки/устройства
 * автора и остальные участники по-прежнему получают событие.
 */
export function getPusherSocketId(): string | null {
  return _pusherClient?.connection?.socket_id ?? null;
}

/** Добавляет socket_id в FormData перед вызовом Server Action (если есть соединение). */
export function appendSocketId(formData: FormData): void {
  const socketId = getPusherSocketId();
  if (socketId) formData.append("socketId", socketId);
}
