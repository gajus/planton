// @flow

/* eslint-disable fp/no-class, fp/no-this */

import ExtendableError from 'es6-error';

export class PlantonError extends ExtendableError {}

export class UnexpectedStateError extends PlantonError {
  code: string;

  constructor (message: string, code = 'UNEXPECTED_STATE_ERROR') {
    super(message);

    this.code = code;
  }
}

export class InvalidTaskConfigurationNameError extends UnexpectedStateError {
  taskName: string;

  constructor (taskName: string, message: string) {
    super(
      message,
      'INVALID_TASK_CONFIGURATION',
    );

    this.taskName = taskName;
  }
}

export class DuplicateTaskNameError extends UnexpectedStateError {
  duplicateTaskName: string;

  constructor (duplicateTaskName: any) {
    super(
      'Task name is duplicate.',
      'DUPLICATE_TASK_NAME',
    );

    this.duplicateTaskName = duplicateTaskName;
  }
}

export class UnexpectedTaskInstructionsError extends UnexpectedStateError {
  taskName: string;

  unexpectedTaskInstructions: any;

  constructor (taskName: string, unexpectedTaskInstructions: any) {
    super(
      'Unexpected task instructions.',
      'UNEXPECTED_TASK_INSTRUCTIONS',
    );

    this.taskName = taskName;
    this.unexpectedTaskInstructions = unexpectedTaskInstructions;
  }
}
