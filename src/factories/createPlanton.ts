import delay from 'delay';
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
  readonly taskName: string;
  readonly instruction: string;
};

type ErrorEvent = {
  readonly taskName: string;
  readonly error: Error;
};

/**
 * @property activeTaskInstructions A list of active task instructions as retrieved using `getActiveTaskInstructions`.
 * @property limit A limit derived based on the value of `concurrency` and the number of `activeTaskInstructions` (CONCURRENCY - ACTIVE TASK INSTRUCTIONS = LIMIT).
 */
type ScheduleConfiguration = {
  readonly activeTaskInstructions: TaskInstruction[];
  readonly limit: number;
};

/**
 *
 */
type Schedule = (configuration: ScheduleConfiguration) => Promise<TaskInstruction[]>;

/**
 * Produces a number (time in milliseconds) representing how long Planton must wait before attempting `schedule` function.
 */
type Delay = (attemptNumber: number) => number;

/**
 * @property concurrency Together with `getActiveTaskInstructions`, the `concurrency` setting is used to generate `limit` value that is passed to task scheduler.
 * @property name A unique name of the task. Used to identify task scheduler in errors and for tracking active task instructions (see `getActiveTaskInstructions`).
 */
type TaskInput = {
  readonly concurrency?: number;
  readonly delay?: Delay;
  readonly name: string;
  readonly schedule: Schedule;
};

/**
 * @property getActiveTaskInstructions Returns list of tasks that are currently being executed. Used for concurrency control.
 */
type PlantonConfiguration = {
  readonly getActiveTaskInstructions: (taskName: string) => TaskInstruction[];
  readonly tasks: TaskInput[]
};

type InternalTask = {
  attemptNumber: number;

  readonly concurrency: number;
  readonly name: string;
  readonly schedule: Schedule;
  readonly terminate: () => void;
};

type EventMap = {
  error: ErrorEvent,
  task: TaskEvent,
};

type Planton = {
  events: Emitter<EventMap>;
  terminate: () => Promise<void>;
}

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

    const calculateDelay = inputTask.delay || (() => {
      return 1_000;
    });

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

    const terminate = (() => {
      let resolveTermination;

      const terminationPromise = new Promise((resolve) => {
        resolveTermination = resolve;
      });

      let active = true;

      // eslint-disable-next-line complexity
      (async () => {
        // eslint-disable-next-line no-unmodified-loop-condition
        while (active) {
          const calculatedDelay = calculateDelay(task.attemptNumber || 0);

          if (calculatedDelay) {
            await delay(calculatedDelay);
          }

          if (!active) {
            break;
          }

          const activeTaskInstructions = await getActiveTaskInstructions(inputTask.name);

          if (activeTaskInstructions.length >= concurrency) {
            break;
          }

          let taskInstructions: TaskInstruction[];

          const limit = concurrency - activeTaskInstructions.length;

          if (limit < 1) {
            throw new UnexpectedStateError('Limit cannot be less than 1.');
          }

          try {
            taskInstructions = await inputTask.schedule({
              activeTaskInstructions,
              limit,
            });
          } catch (error) {
            log.error({
              error: serializeError(error),
              taskName: task.name,
            }, 'scheduler produced an error');

            events.emit('error', {
              error,
              taskName: task.name || '',
            });

            taskInstructions = [];
          }

          if (!Array.isArray(taskInstructions)) {
            events.emit('error', {
              error: new UnexpectedTaskInstructionsError(task.name || '', taskInstructions),
              taskName: task.name || '',
            });

            log.error({
              taskInstructions,
              taskName: task.name,
            }, 'scheduler produced an unexpected result; result is not array');

            taskInstructions = [];
          }

          if (taskInstructions.length > limit) {
            events.emit('error', {
              error: new UnexpectedTaskInstructionsError(task.name || '', taskInstructions),
              taskName: task.name || '',
            });

            log.error({
              taskInstructions,
              taskName: task.name,
            }, 'scheduler produced an unexpected result; instruction number is greater than the limit');

            taskInstructions = [];

            break;
          }

          for (const taskInstruction of taskInstructions) {
            if (typeof taskInstruction !== 'string') {
              events.emit('error', {
                error: new UnexpectedTaskInstructionsError(task.name || '', taskInstructions),
                taskName: task.name || '',
              });

              log.error({
                taskInstructions,
                taskName: task.name,
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
                taskName: task.name || '',
              });
            }
          } else if (task.attemptNumber !== undefined) {
            task.attemptNumber++;
          }

          if (!active) {
            break;
          }
        }

        if (resolveTermination) {
          resolveTermination();
        }
      })();

      return () => {
        active = false;

        return terminationPromise;
      };
    })();

    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore
    task.terminate = terminate;

    tasks.push(task as InternalTask);
  }

  return {
    events,
    terminate: async () => {
      await Promise.all(
        tasks.map((task) => {
          return task.terminate();
        }),
      );
    },
  };
};

export {
  createPlanton,
};
