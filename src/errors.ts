import ExtendableError from 'es6-error';

export class PlantonError extends ExtendableError {}

export class UnexpectedStateError extends PlantonError {
  public code: string;

  public constructor (message: string, code = 'UNEXPECTED_STATE_ERROR') {
    super(message);

    this.code = code;
  }
}

export class InvalidTaskConfigurationNameError extends UnexpectedStateError {
  public taskName: string;

  public constructor (taskName: string, message: string) {
    super(
      message,
      'INVALID_TASK_CONFIGURATION',
    );

    this.taskName = taskName;
  }
}

export class DuplicateTaskNameError extends UnexpectedStateError {
  public duplicateTaskName: string;

  public constructor (duplicateTaskName: string) {
    super(
      'Task name is duplicate.',
      'DUPLICATE_TASK_NAME',
    );

    this.duplicateTaskName = duplicateTaskName;
  }
}

export class UnexpectedTaskInstructionsError extends UnexpectedStateError {
  public taskName: string;

  public unexpectedTaskInstructions: string[];

  public constructor (taskName: string, unexpectedTaskInstructions: string[]) {
    super(
      'Unexpected task instructions.',
      'UNEXPECTED_TASK_INSTRUCTIONS',
    );

    this.taskName = taskName;
    this.unexpectedTaskInstructions = unexpectedTaskInstructions;
  }
}
