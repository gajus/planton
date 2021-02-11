import delay from 'delay';
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error
import Deferred from 'promise-deferred';
import {
  serializeError,
} from 'serialize-error';
import Logger from '../Logger';
import {
  UnexpectedStateError,
  DuplicateTaskNameError,
  InvalidTaskConfigurationNameError,
  UnexpectedTaskInstructionsError,
} from '../errors';
import type {
  Emitter,
} from '../types';
import {
  createEmitter,
} from './createEmitter';

const log = Logger.child({
  namespace: 'createPlanton',
});

type TaskInstruction = string;

type TaskEvent = {
  readonly taskName: string,
  readonly instruction: string,
};

type ErrorEvent = {
  readonly taskName: string,
  readonly error: Error,
};

/**
 * @property activeTaskInstructions A list of active task instructions as retrieved using `getActiveTaskInstructions`.
 * @property concurrency The current concurrency setting value.
 * @property limit A limit derived based on the value of `concurrency` and the number of `activeTaskInstructions` (CONCURRENCY - ACTIVE TASK INSTRUCTIONS = LIMIT).
 */
type ScheduleConfiguration = {
  readonly activeTaskInstructions: TaskInstruction[],
  readonly concurrency: number,
  readonly limit: number,
  readonly taskName: string,
};

/**
 *
 */
type Schedule = (configuration: ScheduleConfiguration) => Promise<TaskInstruction[]>;

/**
 * Produces a number (time in milliseconds) representing how long Planton must wait before attempting `schedule` function.
 */
type CalculateDelay = (attemptNumber: number) => Promise<number> | number;

/**
 * Produces a number indicating how many tasks can be scheduled at most.
 */
type CalculateLimit = (concurrency: number, activeTaskInstructions: TaskInstruction[]) => Promise<number> | number;

/**
 * @property concurrency Together with `getActiveTaskInstructions`, the `concurrency` setting is used to generate `limit` value that is passed to task scheduler.
 * @property name A unique name of the task. Used to identify task scheduler in errors and for tracking active task instructions (see `getActiveTaskInstructions`).
 */
type TaskInput = {
  readonly calculateDelay?: CalculateDelay,
  readonly calculateLimit?: CalculateLimit,
  readonly concurrency?: number,
  readonly name: string,
  readonly schedule: Schedule,
};

/**
 * @property getActiveTaskInstructions Returns list of tasks that are currently being executed. Used for concurrency control.
 */
type PlantonConfiguration = {
  readonly getActiveTaskInstructions: (taskName: string) => Promise<TaskInstruction[]>,
  readonly tasks: TaskInput[],
};

type InternalTask = {
  attemptNumber: number,

  readonly concurrency: number,
  readonly name: string,
  readonly schedule: Schedule,
  readonly terminate: () => Promise<void>,
};

type EventMap = {
  error: ErrorEvent,
  task: TaskEvent,
};

type Planton = {
  events: Emitter<EventMap>,
  terminate: () => Promise<void>,
};

const defaultCalculateDelay: CalculateDelay = () => {
  return 1_000;
};

const defaultCalculateLimit: CalculateLimit = (concurrency, activeTaskInstructions) => {
  return concurrency - activeTaskInstructions.length;
};

const createPlanton = (configuration: PlantonConfiguration): Planton => {
  const {
    getActiveTaskInstructions,
  } = configuration;

  const events = createEmitter<EventMap>();

  const tasks: InternalTask[] = [];

  for (const inputTask of configuration.tasks) {
    log.debug('registered %s task', inputTask.name);

    for (const existingTask of tasks) {
      if (existingTask.name === inputTask.name) {
        throw new DuplicateTaskNameError(existingTask.name);
      }
    }

    const calculateDelay = inputTask.calculateDelay ?? defaultCalculateDelay;

    const calculateLimit = inputTask.calculateLimit ?? defaultCalculateLimit;

    const concurrency = inputTask.concurrency === undefined ? 1 : inputTask.concurrency;

    if (concurrency < 1) {
      throw new InvalidTaskConfigurationNameError(inputTask.name, 'Task concurrency must be greater than 0.');
    }

    const task: Partial<InternalTask> = {
      attemptNumber: 0,
      concurrency,
      name: inputTask.name,
      schedule: inputTask.schedule,
    };

    const taskName = task.name;

    if (!taskName) {
      throw new UnexpectedStateError('Task name cannot be empty.');
    }

    const terminate = (() => {
      let delayPromise: any;

      const deferredTermination = new Deferred();

      let active = true;

      (async () => {
        // eslint-disable-next-line no-unmodified-loop-condition
        while (active) {
          const calculatedDelay = await calculateDelay(task.attemptNumber ?? 0);

          if (calculatedDelay) {
            delayPromise = delay(calculatedDelay);

            await delayPromise;
          }

          if (!active) {
            break;
          }

          const activeTaskInstructions = await getActiveTaskInstructions(taskName);

          if (activeTaskInstructions.length >= concurrency) {
            continue;
          }

          let taskInstructions: TaskInstruction[];

          const limit = await calculateLimit(
            concurrency,
            activeTaskInstructions,
          );

          if (limit < 0) {
            const error = new UnexpectedStateError('Limit must be greater than 0.');

            log.error({
              error: serializeError(error),
              limit,
              taskName,
            }, 'calculateLimit an unexpected result; limit must be greater than 0');

            events.emit('error', {
              error,
              taskName,
            });

            continue;
          }

          if (!Number.isInteger(limit)) {
            const error = new UnexpectedStateError('Limit must be an integer.');

            log.error({
              error: serializeError(error),
              limit,
              taskName,
            }, 'calculateLimit an unexpected result; limit must be an integer');

            events.emit('error', {
              error,
              taskName,
            });

            continue;
          }

          try {
            taskInstructions = await inputTask.schedule({
              activeTaskInstructions,
              concurrency,
              limit,
              taskName,
            });
          } catch (error) {
            log.error({
              error: serializeError(error),
              taskName,
            }, 'scheduler produced an error');

            events.emit('error', {
              error,
              taskName,
            });

            taskInstructions = [];
          }

          if (!Array.isArray(taskInstructions)) {
            events.emit('error', {
              error: new UnexpectedTaskInstructionsError(taskName, taskInstructions),
              taskName,
            });

            log.error({
              taskInstructions,
              taskName,
            }, 'scheduler produced an unexpected result; result is not array');

            taskInstructions = [];
          }

          if (taskInstructions.length > limit) {
            events.emit('error', {
              error: new UnexpectedTaskInstructionsError(taskName, taskInstructions),
              taskName,
            });

            log.error({
              taskInstructions,
              taskName,
            }, 'scheduler produced an unexpected result; instruction number is greater than the limit');

            taskInstructions = [];
          }

          for (const taskInstruction of taskInstructions) {
            if (typeof taskInstruction !== 'string') {
              events.emit('error', {
                error: new UnexpectedTaskInstructionsError(taskName, taskInstructions),
                taskName,
              });

              log.error({
                taskInstructions,
                taskName,
              }, 'scheduler produced an unexpected result; array members are not string');

              taskInstructions = [];

              break;
            }
          }

          if (taskInstructions.length > 0) {
            task.attemptNumber = 0;

            for (const taskInstruction of taskInstructions) {
              events.emit('task', {
                instruction: taskInstruction,
                taskName,
              });
            }
          } else if (task.attemptNumber !== undefined) {
            task.attemptNumber++;
          }

          if (!active) {
            break;
          }
        }

        deferredTermination.resolve();
      })();

      return () => {
        active = false;

        if (delayPromise) {
          delayPromise.clear();
        }

        return deferredTermination.promise;
      };
    })();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-expect-error
    task.terminate = terminate;

    tasks.push(task as InternalTask);
  }

  return {
    events,
    terminate: async () => {
      await Promise.all(
        tasks.map(async (task) => {
          await task.terminate();
        }),
      );
    },
  };
};

export {
  createPlanton,
};
