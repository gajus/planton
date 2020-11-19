import delay from 'delay';
import Logger from '../Logger';
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

type ScheduleConfigurationInput = {
  readonly activeTaskInstructions: TaskInstruction[];
  readonly limit: number;
};

type Schedule = (configuration: ScheduleConfigurationInput) => Promise<TaskInstruction[]>;

type Delay = (attemptNumber: number) => number;

type TaskInput = {
  readonly concurrency?: number;
  readonly exclusive?: boolean;
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
  readonly exclusive: boolean;
  readonly name: string;
  readonly schedule: Schedule;
  readonly terminate: () => void;
};

type EventMap = {
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

    const calculateDelay = inputTask.delay || (() => {
      return 1_000;
    });

    const concurrency = inputTask.concurrency || 1;

    const task: Partial<InternalTask> = {
      attemptNumber: 0,
      concurrency,
      exclusive: inputTask.exclusive !== false,
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

          const taskInstructions = await inputTask.schedule({
            activeTaskInstructions,
            limit: concurrency - activeTaskInstructions.length,
          });

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
