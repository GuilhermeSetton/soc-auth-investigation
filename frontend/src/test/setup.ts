import { afterEach, expect } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically clean up after each test
afterEach(() => {
  cleanup();
});

// Custom DOM matchers using standard DOM APIs without extra packages
expect.extend({
  toBeInTheDocument(received: Element | null | undefined) {
    const pass = Boolean(received && document.body.contains(received));
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to be in document`,
    };
  },
  toHaveValue(received: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null, expected: string | number) {
    const pass = received?.value === String(expected);
    return {
      pass,
      message: () => `expected element value ${pass ? 'not ' : ''}to equal '${expected}', got '${received?.value}'`,
    };
  },
  toHaveClass(received: Element | null, className: string) {
    const pass = Boolean(received?.classList.contains(className));
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to have class '${className}'`,
    };
  },
  toBeDisabled(received: HTMLButtonElement | HTMLInputElement | null) {
    const pass = Boolean(received?.disabled || received?.getAttribute('disabled') !== null);
    return {
      pass,
      message: () => `expected element ${pass ? 'not ' : ''}to be disabled`,
    };
  },
  toHaveFocus(received: Element | null | undefined) {
    const pass = Boolean(received && document.activeElement === received);
    return {
      pass,
      message: () =>
        `expected element ${pass ? 'not ' : ''}to have focus, activeElement is <${document.activeElement?.tagName?.toLowerCase()} id="${document.activeElement?.id || ''}" class="${document.activeElement?.className || ''}">`,
    };
  },
});
