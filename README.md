# Planton 🐳

[![Travis build status](https://img.shields.io/travis/com/gajus/planton?style=flat-square)](https://travis-ci.com/gajus/planton)
[![Coveralls](https://img.shields.io/coveralls/gajus/planton.svg?style=flat-square)](https://coveralls.io/github/gajus/planton)
[![NPM version](http://img.shields.io/npm/v/planton.svg?style=flat-square)](https://www.npmjs.org/package/planton)
[![Canonical Code Style](https://img.shields.io/badge/code%20style-canonical-blue.svg?style=flat-square)](https://github.com/gajus/canonical)
[![Twitter Follow](https://img.shields.io/twitter/follow/kuizinas.svg?style=social&label=Follow)](https://twitter.com/kuizinas)

Database-agnostic task scheduler.

* [Motivation](#motivation)
* [Example Usage](#example-usage)
* [Executing Tasks](#executing-tasks)

## Motivation

In every project I have undertaken, there was always a need to run a periodic task of some sorts, e.g. hard-delete after 14-day soft delete. Typically this problem is solved by using a CRON-like system that simply runs a task at a set interval. However, ad-hoc solutions are added as requirements evolve, e.g. the need to run a task at a different interval and concurrency depending on whether the last attempt at running the task was successful. Planton is a database-agnostic task scheduler for these type of tasks that abstracts logic for handling concurrency and different task scheduling strategies.

## Example Usage

```js
import {
  createPlanton,
} from 'planton';

const planton = createPlanton({
  getActiveTaskInstructions: (taskName) => {
    return pool.anyFirst(sql`
      SELECT mte1.instruction
      FROM maintenance_task_execution mte1
      WHERE
        mte1.task_name = ${taskName} AND
        mte1.ended_at IS NULL
    `);
  },
  tasks: [
    {
      // New task scheduling will be attempted only when there are less than 2
      // active instructions for the current task.
      concurrency: 2,
      delay: (attemptNumber) => {
        // `attemptNumber` indicates how many times `poll` was called
        // without producing new instructions.
        if (attemptNumber === 0) {
          return 100;
        }

        // Incrementally increase back-off time when there are no new instructions.
        // In production, consider using something more advanced (e.g. https://www.npmjs.com/package/simple-backoff).
        return Math.max(
          attemptNumber * 1000,
          60 * 1000,
        );
      },
      name: 'send_user_email',
      poll: ({activeTaskInstructions, limit}) => {
        return pool.anyFirst(sql`
          UPDATE user_account as ua2
          SET email_sent_at = now()
          WHERE
            ua2.id = ANY(
              SELECT ua1.id
              FROM user_account ua1
              WHERE
                ua1.email_sent_at IS NULL AND
                ua1.id != ALL(${sql.array(activeTaskInstructions, 'int4')})
              LIMIT ${limit}
              FOR UPDATE OF ua1 SKIP LOCKED
            )
          RETURNING ua2.id
        `);
      },
    },
  ],
});

planton.events.on('task', (task) => {
  // {
  //   taskName: 'send_user_email',
  //   instruction: 1,
  // };
  console.log(task);
});

```

## Executing Tasks

Planton is only responsible for dispatching the job tasks, i.e. task execution is outside of the scope of this package.

Use one the popular message queue systems:

* [RabbitMQ](https://www.rabbitmq.com/)
* [BullMQ](https://github.com/taskforcesh/bullmq)
