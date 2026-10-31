const sameOriginGame = typeof location !== 'undefined' && location.pathname.startsWith('/game/');
export const ROOM_API_URL = sameOriginGame
  ? new URL('/api', location.href).href
  : 'https://word-meet-csq-an94.chirpy-lemur-3231.chatgpt.site/api';
