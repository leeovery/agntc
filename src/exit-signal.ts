export class ExitSignal extends Error {
  readonly code: number;

  constructor(code: number) {
    super(`exit:${code}`);
    this.name = "ExitSignal";
    this.code = code;
  }
}
