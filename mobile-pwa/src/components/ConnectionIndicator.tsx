import type { ConnectionState } from '../state/useWebSocket';

// Re-export for convenience
export type { ConnectionState };

interface ConnectionIndicatorProps {
  state: ConnectionState;
}

export function ConnectionIndicator({ state }: ConnectionIndicatorProps) {
  const config = {
    connected: { color: 'bg-green-500', text: 'Connected', pulse: true },
    connecting: { color: 'bg-yellow-500', text: 'Connecting...', pulse: true },
    reconnecting: { color: 'bg-orange-500', text: 'Reconnecting...', pulse: true },
    disconnected: { color: 'bg-red-500', text: 'Disconnected', pulse: false },
  };

  const { color, text, pulse } = config[state];

  return (
    <div className="flex items-center gap-2">
      <div className={`w-2 h-2 rounded-full ${color} ${pulse ? 'animate-pulse' : ''}`} />
      <span className="text-xs text-white/50 font-medium">{text}</span>
    </div>
  );
}
