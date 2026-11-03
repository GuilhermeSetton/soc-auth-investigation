import 'vitest';

interface CustomMatchers<R = unknown> {
  toBeInTheDocument(): R;
  toHaveValue(expected: string | number): R;
  toHaveClass(className: string): R;
  toBeDisabled(): R;
  toHaveFocus(): R;
}

declare module 'vitest' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  interface Assertion<T = any> extends CustomMatchers<T> {}
  interface AsymmetricMatchersContaining extends CustomMatchers {}
}
