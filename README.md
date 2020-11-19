# Planton 🐳

[![Travis build status](https://img.shields.io/travis/com/gajus/planton?style=flat-square)](https://travis-ci.com/gajus/planton)
[![Coveralls](https://img.shields.io/coveralls/gajus/planton.svg?style=flat-square)](https://coveralls.io/github/gajus/planton)
[![NPM version](http://img.shields.io/npm/v/planton.svg?style=flat-square)](https://www.npmjs.org/package/planton)
[![Canonical Code Style](https://img.shields.io/badge/code%20style-canonical-blue.svg?style=flat-square)](https://github.com/gajus/canonical)
[![Twitter Follow](https://img.shields.io/twitter/follow/kuizinas.svg?style=social&label=Follow)](https://twitter.com/kuizinas)

Database-agnostic task scheduler.

* [Motivation](#motivation)
* [Example Usage](#example-usage)
* [Example Database Schema](#example-database-schema)
* [Executing Tasks](#executing-tasks)

## Motivation

In every project I have undertaken, there was always a need to run a periodic task of some sorts, e.g. hard-delete after 14-day soft delete. Typically this problem is solved by using a CRON-like system that simply runs a task at a set interval. However, ad-hoc solutions are added as requirements evolve, e.g. the need to run a task at a different interval and concurrency depending on whether the last attempt at running the task was successful.

Planton is a database-agnostic task scheduler for these type of tasks that abstracts logic for handling concurrency and different task scheduling strategies.

## Example Usage

```js
import {
  createPlanton,
} from 'planton';

const planton = createPlanton({
  getActiveTaskInstructions: (taskName) => {
    return pool.anyFirst(sql`
      SELECT mte1.instruction
      FROM maintenance_task mt1
      INNER JOIN maintenance_task_execution mte1 ON mte1.maintenance_task_id = mt1.id
      WHERE
        mt1.nid = ${taskName} AND
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

## Example Database Schema

While Planton is 100% database agnostic, an example schema may help you to get started. Below is a PostgreSQL schema on which the usage example is based.

The key insights from the schema:

* `nid` (named identifier) is used to establishing relationship between task instructions in the codebase and the database.
* Each task execution gets a record in `maintenance_task_execution` which records instructions passed by Planton.
* There are a lot of supporting fields used to describe the state of the task execution. All of these fields are provided for example purposes only. It is up to the task executor to utilise them.
* `maintenance_task_execution` is `UNLOGGED` for performance reasons.

```sql
CREATE TABLE public.maintenance_task (
  id integer NOT NULL,
  nid text NOT NULL,
  maximum_execution_duration interval DEFAULT '00:05:00'::interval NOT NULL,
  maximum_concurrent_execution_count integer DEFAULT 0 NOT NULL
);

CREATE UNLOGGED TABLE public.maintenance_task_execution (
  id integer NOT NULL,
  maintenance_task_id integer NOT NULL,
  instruction text,
  started_at timestamp with time zone NOT NULL,
  ended_at timestamp with time zone,
  hostname text,
  state text NOT NULL,
  error jsonb,
  terminated_at timestamp with time zone,
  terminated_reason text,
  last_seen_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT maintenance_task_execution_check CHECK (((state = 'COMPLETED'::text) OR (ended_at IS NULL))),
  CONSTRAINT maintenance_task_execution_check1 CHECK (((terminated_at IS NULL) OR (ended_at IS NOT NULL))),
  CONSTRAINT maintenance_task_execution_state_check CHECK ((state = ANY (ARRAY['RUNNING'::text, 'COMPLETED'::text])))
);

CREATE INDEX maintenance_task_id_idx
ON public.maintenance_task_execution
USING btree (maintenance_task_id);

CREATE INDEX maintenance_task_execution_ended_at_maintenance_task_id_idx
ON public.maintenance_task_execution
USING btree (ended_at, maintenance_task_id);

CREATE INDEX maintenance_task_execution_maintenance_task_id_idx
ON public.maintenance_task_execution
USING btree (maintenance_task_id)
WHERE (ended_at IS NULL);

CREATE UNIQUE INDEX maintenance_task_name_idx
ON public.maintenance_task
USING btree (nid);

ALTER TABLE ONLY public.maintenance_task_execution
ADD CONSTRAINT maintenance_task_execution_maintenance_task_id_fkey
FOREIGN KEY (maintenance_task_id)
REFERENCES public.maintenance_task(id)
ON DELETE CASCADE;

```

## Executing Tasks

Planton is only responsible for dispatching the job tasks, i.e. task execution is outside of the scope of this package.

Use one the popular message queue systems:

* [RabbitMQ](https://www.rabbitmq.com/)
* [BullMQ](https://github.com/taskforcesh/bullmq)
