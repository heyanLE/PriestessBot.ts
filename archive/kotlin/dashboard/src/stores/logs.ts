import { defineStore } from 'pinia';
import { ref } from 'vue';
import { dashboardApiToken, type LogEventDto } from '../api/dashboard';

export const useLogStore = defineStore('logs', () => {
  const events = ref<LogEventDto[]>([]);
  const connected = ref(false);
  const error = ref<string | null>(null);
  let socket: WebSocket | null = null;

  function connect() {
    if (socket && (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN)) return;
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const token = dashboardApiToken();
    const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
    socket = new WebSocket(`${protocol}//${window.location.host}/ws/logs${tokenQuery}`);
    socket.onopen = () => {
      connected.value = true;
      error.value = null;
    };
    socket.onclose = () => {
      connected.value = false;
    };
    socket.onerror = () => {
      error.value = 'Log socket connection failed';
    };
    socket.onmessage = (message) => {
      try {
        events.value = [JSON.parse(message.data) as LogEventDto, ...events.value].slice(0, 200);
      } catch {
        events.value = [{ level: 'INFO', message: String(message.data), timestamp: Date.now() }, ...events.value].slice(0, 200);
      }
    };
  }

  function clear() {
    events.value = [];
  }

  return { events, connected, error, connect, clear };
});
