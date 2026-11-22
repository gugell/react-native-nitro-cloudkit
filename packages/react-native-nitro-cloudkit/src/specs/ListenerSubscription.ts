/** A registered listener; `remove()` stops it. */
export interface ListenerSubscription {
  remove: () => void;
}
