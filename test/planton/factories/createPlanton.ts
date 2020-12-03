import test from 'ava';
import delay from 'delay';
import sinon from 'sinon';
import {
  createPlanton,
} from '../../../src/factories/createPlanton';

test('schedules tasks at a interval', async (t) => {
  const schedule = sinon
    .stub()
    .returns([]);

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 90;
        },
        name: 'foo',
        schedule,
      },
    ],
  });

  await delay(900);

  t.is(schedule.callCount, 9);

  await planton.terminate();
});

test('throws if concurrency is lower than 1', (t) => {
  const error = t.throws(() => {
    createPlanton({
      getActiveTaskInstructions: () => {
        return [];
      },
      tasks: [
        {
          concurrency: 0,
          delay: () => {
            return 90;
          },
          name: 'foo',
          schedule: async () => {
            return [];
          },
        },
      ],
    });
  });

  t.like(error, {
    code: 'INVALID_TASK_CONFIGURATION',
    message: 'Task concurrency must be greater than 0.',
  });
});

test('throws if multiple tasks are registered with the same name', (t) => {
  const error = t.throws(() => {
    createPlanton({
      getActiveTaskInstructions: () => {
        return [];
      },
      tasks: [
        {
          delay: () => {
            return 90;
          },
          name: 'foo',
          schedule: async () => {
            return [];
          },
        },
        {
          delay: () => {
            return 90;
          },
          name: 'foo',
          schedule: async () => {
            return [];
          },
        },
      ],
    });
  });

  t.like(error, {
    code: 'DUPLICATE_TASK_NAME',
    duplicateTaskName: 'foo',
  });
});

test('stops scheduling after Planton is terminated', async (t) => {
  const schedule = sinon
    .stub()
    .onFirstCall()
    .returns([])
    .onSecondCall()
    .throws();

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 200;
        },
        name: 'foo',
        schedule,
      },
    ],
  });

  await delay(250);

  t.is(schedule.callCount, 1);

  await planton.terminate();

  await delay(200);

  t.is(schedule.callCount, 1);
});

test('emits "task" event for every new task instruction', async (t) => {
  const schedule = sinon
    .stub()
    .returns([
      'bar',
      'baz',
    ]);

  const eventHandler = sinon.spy();

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        concurrency: 2,
        delay: () => {
          return 100;
        },
        name: 'foo',
        schedule,
      },
    ],
  });

  planton.events.on('task', eventHandler);

  await delay(150);

  t.is(eventHandler.callCount, 2);
  t.deepEqual(eventHandler.firstCall.firstArg, {
    instruction: 'bar',
    taskName: 'foo',
  });
  t.deepEqual(eventHandler.secondCall.firstArg, {
    instruction: 'baz',
    taskName: 'foo',
  });

  await planton.terminate();
});

test('does not attempt to schedule tasks when active tasks >= concurrency limit', async (t) => {
  const schedule = sinon
    .stub()
    .throws();

  const eventHandler = sinon.spy();

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [
        'foo',
        'bar',
      ];
    },
    tasks: [
      {
        concurrency: 1,
        delay: () => {
          return 100;
        },
        name: 'foo',
        schedule,
      },
    ],
  });

  planton.events.on('task', eventHandler);

  await delay(150);

  t.is(eventHandler.callCount, 0);
  t.is(schedule.callCount, 0);

  await planton.terminate();
});

test('invokes schedule with the limit adjusted based on the number of current active tasks', async (t) => {
  const schedule = sinon
    .stub()
    .returns([]);

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [
        'foo',
        'bar',
      ];
    },
    tasks: [
      {
        concurrency: 3,
        delay: () => {
          return 100;
        },
        name: 'foo',
        schedule,
      },
    ],
  });

  await delay(150);

  t.is(schedule.callCount, 1);
  t.is(schedule.firstCall.firstArg.limit, 1);

  await planton.terminate();
});

test('invokes schedule with the current active task instructions', async (t) => {
  const schedule = sinon
    .stub()
    .returns([]);

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [
        'foo',
        'bar',
      ];
    },
    tasks: [
      {
        concurrency: 3,
        delay: () => {
          return 100;
        },
        name: 'foo',
        schedule,
      },
    ],
  });

  await delay(150);

  t.is(schedule.callCount, 1);
  t.deepEqual(schedule.firstCall.firstArg.activeTaskInstructions, [
    'foo',
    'bar',
  ]);

  await planton.terminate();
});

test('invokes `delay` with the number of attempts since the last time `schedule` produced results', async (t) => {
  const schedule = sinon
    .stub()
    .onFirstCall()
    .returns([])
    .onSecondCall()
    .returns([
      'foo',
    ]);

  const calculateDelay = sinon.stub().returns(50);

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: calculateDelay,
        name: 'foo',
        schedule,
      },
    ],
  });

  await delay(150);

  t.is(schedule.callCount, 2);

  t.is(calculateDelay.firstCall.firstArg, 0);
  t.is(calculateDelay.secondCall.firstArg, 1);
  t.is(calculateDelay.thirdCall.firstArg, 0);

  await planton.terminate();
});

test('terminate waits for scheduling to complete', async (t) => {
  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 50;
        },
        name: 'foo',
        schedule: async () => {
          await delay(500);

          return [];
        },
      },
    ],
  });

  await delay(50);

  const startTermination = Date.now();

  await planton.terminate();

  t.true(Date.now() - startTermination >= 500);
});

test('emits error if scheduler produces an error', async (t) => {
  const eventHandler = sinon.spy();

  const error = new Error('foo');

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 50;
        },
        name: 'foo',
        schedule: async () => {
          throw error;

          return [];
        },
      },
    ],
  });

  planton.events.on('error', eventHandler);

  await delay(190);

  // Ensures that we do not stop calling scheduler after the first error.
  // Ensures that even after error we use the same delay.
  t.is(eventHandler.callCount, 3);

  t.deepEqual(eventHandler.firstCall.firstArg, {
    error,
    taskName: 'foo',
  });
});

test('emits error if scheduler produces more results than the supplied limit', async (t) => {
  const eventHandler = sinon.spy();

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        concurrency: 1,
        delay: () => {
          return 50;
        },
        name: 'foo',
        schedule: async () => {
          return [
            '1',
            '2',
            '3',
          ];
        },
      },
    ],
  });

  planton.events.on('error', eventHandler);

  await delay(90);

  t.is(eventHandler.callCount, 1);

  t.like(eventHandler.firstCall.firstArg.error, {
    code: 'UNEXPECTED_TASK_INSTRUCTIONS',
    unexpectedTaskInstructions: [
      '1',
      '2',
      '3',
    ],
  });
});

test('unexpected scheduler result shape triggers an error (not array)', async (t) => {
  const eventHandler = sinon.spy();

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 50;
        },
        name: 'foo',

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        schedule: async () => {
          return {
            foo: 'bar',
          };
        },
      },
    ],
  });

  planton.events.on('error', eventHandler);

  await delay(90);

  t.is(eventHandler.callCount, 1);

  t.like(eventHandler.firstCall.firstArg.error, {
    code: 'UNEXPECTED_TASK_INSTRUCTIONS',
    unexpectedTaskInstructions: {
      foo: 'bar',
    },
  });
});

test('unexpected scheduler result shape triggers an error (not an array of string literals)', async (t) => {
  const eventHandler = sinon.spy();

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 50;
        },
        name: 'foo',

        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-ignore
        schedule: async () => {
          return [
            {
              foo: 'bar',
            },
          ];
        },
      },
    ],
  });

  planton.events.on('error', eventHandler);

  await delay(90);

  t.is(eventHandler.callCount, 1);

  t.like(eventHandler.firstCall.firstArg.error, {
    code: 'UNEXPECTED_TASK_INSTRUCTIONS',
    unexpectedTaskInstructions: [
      {
        foo: 'bar',
      },
    ],
  });
});

test('high-frequency issues do not block other tasks', async (t) => {
  const foo = sinon
    .stub()
    .callsFake(async () => {
      await delay(10);

      return [];
    });

  const bar = sinon
    .stub()
    .callsFake(async () => {
      await delay(10);

      return [];
    });

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 5;
        },
        name: 'foo',
        schedule: foo,
      },
      {
        delay: () => {
          return 50;
        },
        name: 'bar',
        schedule: bar,
      },
    ],
  });

  await delay(190);

  t.true(foo.callCount > 2);
  t.true(bar.callCount > 2);
});

test('scheduler executions are evenly distributed', async (t) => {
  const foo = sinon
    .stub()
    .returns([]);

  const bar = sinon
    .stub()
    .returns([]);

  const baz = sinon
    .stub()
    .returns([]);

  const planton = createPlanton({
    getActiveTaskInstructions: () => {
      return [];
    },
    tasks: [
      {
        delay: () => {
          return 5;
        },
        name: 'foo',
        schedule: foo,
      },
      {
        delay: () => {
          return 5;
        },
        name: 'bar',
        schedule: bar,
      },
      {
        delay: () => {
          return 5;
        },
        name: 'baz',
        schedule: baz,
      },
    ],
  });

  await delay(100);

  t.true(Math.abs(foo.callCount - bar.callCount) < 2);
  t.true(Math.abs(bar.callCount - baz.callCount) < 2);
  t.true(Math.abs(foo.callCount - baz.callCount) < 2);

  await planton.terminate();
});

test('continues to attempt scheduling tasks that breach concurrency', async (t) => {
  const getActiveTaskInstructions = sinon
    .stub()
    .returns(['1']);

  const planton = createPlanton({
    getActiveTaskInstructions,
    tasks: [
      {
        concurrency: 1,
        delay: () => {
          return 10;
        },
        name: 'foo',
        schedule: () => {
          throw new Error('Should not be called.');
        },
      },
    ],
  });

  await delay(100);

  t.true(getActiveTaskInstructions.callCount > 3);

  await planton.terminate();
});
