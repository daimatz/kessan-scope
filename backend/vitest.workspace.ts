import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  './vitest.config.ts',
  {
    test: {
      name: 'node',
      include: ['test/documentClassifier.spec.ts', 'test/newReleasesChecker.spec.ts', 'test/earningsAnalyzer.spec.ts', 'test/mailersend.spec.ts'],
      environment: 'node',
    },
  },
]);
