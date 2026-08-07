'use client';

import { useState, useEffect } from 'react';
import { api } from '@/lib/api';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? '';

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export type PushState = 'unsupported' | 'denied' | 'subscribed' | 'unsubscribed' | 'loading';

export function usePushNotifications() {
  const [state, setState] = useState<PushState>('loading');

  useEffect(() => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported');
      return;
    }
    if (Notification.permission === 'denied') {
      setState('denied');
      return;
    }
    navigator.serviceWorker.ready.then((reg) => {
      reg.pushManager.getSubscription().then((sub) => {
        setState(sub ? 'subscribed' : 'unsubscribed');
      });
    });
  }, []);

  const subscribe = async (): Promise<boolean> => {
    setState('loading');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
      const json = sub.toJSON();
      await api.pushSubscribe({
        endpoint:    json.endpoint!,
        public_key:  json.keys!.p256dh,
        auth_token:  json.keys!.auth,
        device_name: navigator.userAgent.slice(0, 100),
      });
      setState('subscribed');
      return true;
    } catch {
      setState('unsubscribed');
      return false;
    }
  };

  const unsubscribe = async (): Promise<void> => {
    setState('loading');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await api.pushUnsubscribe(sub.endpoint);
      await sub.unsubscribe();
    }
    setState('unsubscribed');
  };

  const sendTest = () => api.pushTest();

  return { state, subscribe, unsubscribe, sendTest };
}
