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
