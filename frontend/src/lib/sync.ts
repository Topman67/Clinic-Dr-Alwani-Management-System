type DataSyncEvent = {
  sourceTabId: string;
  timestamp: number;
};

const APP_SYNC_EVENT_NAME = 'cms:data-sync';

const CHANNEL_NAME = 'cms-data-sync';
const STORAGE_KEY = 'cms_data_sync_event';
const TAB_ID_KEY = 'cms_tab_id';

const hasBroadcastChannel = typeof BroadcastChannel !== 'undefined';
const channel = hasBroadcastChannel ? new BroadcastChannel(CHANNEL_NAME) : null;

const generateTabId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

export const getCurrentTabId = (): string => {
  const existing = sessionStorage.getItem(TAB_ID_KEY);
  if (existing) return existing;
  const next = generateTabId();
  sessionStorage.setItem(TAB_ID_KEY, next);
  return next;
};

export const emitDataChanged = () => {
  const payload: DataSyncEvent = {
    sourceTabId: getCurrentTabId(),
    timestamp: Date.now(),
  };

  if (channel) {
    channel.postMessage(payload);
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  localStorage.removeItem(STORAGE_KEY);
};

export const subscribeDataChanged = (listener: (payload: DataSyncEvent) => void) => {
  const onChannelMessage = (event: MessageEvent<DataSyncEvent>) => {
    if (event.data) {
      listener(event.data);
    }
  };

  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY || !event.newValue) return;
    try {
      const parsed = JSON.parse(event.newValue) as DataSyncEvent;
      listener(parsed);
    } catch {
      // ignore malformed payloads
    }
  };

  if (channel) {
    channel.addEventListener('message', onChannelMessage);
  }

  window.addEventListener('storage', onStorage);

  return () => {
    if (channel) {
      channel.removeEventListener('message', onChannelMessage);
    }
    window.removeEventListener('storage', onStorage);
  };
};

export const notifyInAppDataSync = (payload: DataSyncEvent) => {
  window.dispatchEvent(new CustomEvent<DataSyncEvent>(APP_SYNC_EVENT_NAME, { detail: payload }));
};

export const subscribeInAppDataSync = (listener: (payload: DataSyncEvent) => void) => {
  const onSync = (event: Event) => {
    const customEvent = event as CustomEvent<DataSyncEvent>;
    if (customEvent.detail) {
      listener(customEvent.detail);
    }
  };

  window.addEventListener(APP_SYNC_EVENT_NAME, onSync);
  return () => {
    window.removeEventListener(APP_SYNC_EVENT_NAME, onSync);
  };
};
