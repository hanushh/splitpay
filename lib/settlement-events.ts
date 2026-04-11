// Lightweight pub/sub for settlement-recorded events.
// Used to notify the balances screen to refetch after a settlement is saved,
// because useFocusEffect is unreliable on Android when dismissing modals.

type Listener = () => void;
const listeners: Set<Listener> = new Set();

export const settlementEvents = {
  emit: () => listeners.forEach((fn) => fn()),
  subscribe: (fn: Listener): (() => void) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
