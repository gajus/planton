export type EventMap = Record<string, any>;

type EventKey<T extends EventMap> = string & keyof T;
type EventReceiver<T> = (parameters: T) => void;

export type Emitter<T extends EventMap> = {
  on: <K extends EventKey<T>>(eventName: K, function_: EventReceiver<T[K]>) => void,
  off: <K extends EventKey<T>>(eventName: K, function_: EventReceiver<T[K]>) => void,
  emit: <K extends EventKey<T>>(eventName: K, parameters: T[K]) => void,
};
