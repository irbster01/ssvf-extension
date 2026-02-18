import { useEffect, useRef, useCallback } from 'react';
import * as signalR from '@microsoft/signalr';
import { negotiateSignalR } from '../api/submissions';
import { Message } from '../types';

interface UseSignalROptions {
  getToken: () => Promise<string>;
  currentUserEmail: string;
  onNewMessage?: (message: Message) => void;
  onUnreadCountUpdate?: (submissionId: string, delta: number) => void;
}

/**
 * Connects to Azure SignalR Service in serverless mode.
 * Listens for `newMessage` events and notifies the caller.
 */
export function useSignalR({
  getToken,
  currentUserEmail,
  onNewMessage,
  onUnreadCountUpdate,
}: UseSignalROptions) {
  const connectionRef = useRef<signalR.HubConnection | null>(null);
  const retriesRef = useRef(0);
  const maxRetries = 5;

  const connect = useCallback(async () => {
    // Avoid double-connections
    if (connectionRef.current?.state === signalR.HubConnectionState.Connected) return;

    try {
      const token = await getToken();
      const negotiate = await negotiateSignalR(token);

      if (!negotiate.configured || !negotiate.url || !negotiate.accessToken) {
        console.warn('[SignalR] Not configured — real-time messaging disabled');
        return;
      }

      const connection = new signalR.HubConnectionBuilder()
        .withUrl(negotiate.url, {
          accessTokenFactory: () => negotiate.accessToken!,
        })
        .withAutomaticReconnect({
          nextRetryDelayInMilliseconds: (ctx) => {
            // Exponential back-off: 1s, 2s, 4s, 8s, 16s then stop
            if (ctx.previousRetryCount >= maxRetries) return null;
            return Math.min(1000 * Math.pow(2, ctx.previousRetryCount), 16000);
          },
        })
        .configureLogging(signalR.LogLevel.Warning)
        .build();

      // Listen for new messages
      connection.on('newMessage', (message: Message) => {
        // Only process messages from others
        if (message.sentBy === currentUserEmail) return;

        onNewMessage?.(message);
        onUnreadCountUpdate?.(message.submissionId, 1);
      });

      connection.onreconnecting(() => {
        console.info('[SignalR] Reconnecting...');
      });

      connection.onreconnected(() => {
        console.info('[SignalR] Reconnected');
        retriesRef.current = 0;
      });

      connection.onclose(async (err) => {
        console.warn('[SignalR] Connection closed', err);
        connectionRef.current = null;
        // Attempt manual reconnect after a delay if auto-reconnect exhausted
        if (retriesRef.current < maxRetries) {
          retriesRef.current++;
          setTimeout(() => connect(), 5000 * retriesRef.current);
        }
      });

      await connection.start();
      connectionRef.current = connection;
      retriesRef.current = 0;
      console.info('[SignalR] Connected');
    } catch (err) {
      console.warn('[SignalR] Failed to connect', err);
      // Retry after delay
      if (retriesRef.current < maxRetries) {
        retriesRef.current++;
        setTimeout(() => connect(), 5000 * retriesRef.current);
      }
    }
  }, [getToken, currentUserEmail, onNewMessage, onUnreadCountUpdate]);

  useEffect(() => {
    if (!currentUserEmail) return;

    connect();

    return () => {
      connectionRef.current?.stop().catch(() => {});
      connectionRef.current = null;
    };
    // We intentionally only run this on mount/unmount and email change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUserEmail]);

  return {
    connected: connectionRef.current?.state === signalR.HubConnectionState.Connected,
  };
}
