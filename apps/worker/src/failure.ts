/**
 * A deployment that failed on its own merits — bad zip, undeployable contents,
 * a build script that exited non-zero. Terminal: retrying runs the same code
 * against the same input and fails the same way.
 *
 * Everything else that throws (storage, Docker, Postgres) is a system error and
 * gets requeued instead.
 */
export class BuildFailure extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BuildFailure";
  }
}
