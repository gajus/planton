import {
  EventEmitter,
} from 'events';
import type {
  EventMap,
  Emitter,
} from '../types';

export const createEmitter = <T extends EventMap> (): Emitter<T> => {
  return new EventEmitter();
};
