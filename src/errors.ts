// @flow

/* eslint-disable fp/no-class, fp/no-this */

import ExtendableError from 'es6-error';

export class UnexpectedStateError extends ExtendableError {
  code: string;

  constructor (message: string, code = 'UNEXPECTED_STATE_ERROR') {
    super(message);

    this.code = code;
  }
}

export class UnexpectedTaskInstructionsError extends UnexpectedStateError {
  unexpectedTaskInstructions: any;

  constructor (unexpectedTaskInstructions: any) {
    super(
      'Unexpected task instruction shape.',
      'UNEXPECTED_TASK_INSTRUCTION_SHAPE',
    );

    this.unexpectedTaskInstructions = unexpectedTaskInstructions;
  }
}
