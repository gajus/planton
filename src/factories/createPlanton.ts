import delay from 'delay';
import {
  serializeError,
} from 'serialize-error';
import Logger from '../Logger';
import {
  DuplicateTaskNameError,
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

type ScheduleConfigurationInput = {
  readonly activeTaskInstructions: TaskInstruction[];
  readonly limit: number;
};

type Schedule = (configuration: ScheduleConfigurationInput) => Promise<TaskInstruction[]>;

type Delay = (attemptNumber: number) => number;

type TaskInput = {
  readonly concurrency?: number;
  readonly delay?: Delay;
  readonly name: string;
  readonly schedule: Schedule;
};

type PlantonConfigurationInput = {
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

const createPlanton = (configuration: PlantonConfigurationInput): Planton => {
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

    const concurrency = inputTask.concurrency || 1;

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

      (async () => {
        // eslint-disable-next-line no-unmodified-loop-condition
        while (active) {
          const activeTaskInstructions = await getActiveTaskInstructions(inputTask.name);

          if (activeTaskInstructions.length >= concurrency) {
            break;
          }

          let taskInstructions: TaskInstruction[];

          try {
            taskInstructions = await inputTask.schedule({
              activeTaskInstructions,
              limit: concurrency - activeTaskInstructions.length,
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
              error: new UnexpectedTaskInstructionsError(taskInstructions),
              taskName: task.name || '',
            });

            log.error({
              taskInstructions,
              taskName: task.name,
            }, 'scheduler produced an unexpected result; result is not array');

            taskInstructions = [];
          }

          for (const taskInstruction of taskInstructions) {
            if (typeof taskInstruction !== 'string') {
              events.emit('error', {
                error: new UnexpectedTaskInstructionsError(taskInstructions),
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

          const calculatedDelay = calculateDelay(task.attemptNumber || 0);

          if (calculatedDelay) {
            await delay(calculatedDelay);
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
