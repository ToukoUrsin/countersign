import { describe, expect, test } from 'bun:test';
import { compareDependencyTrees, scanSensitiveLines } from './security';

describe('security lens dependency diff', () => {
  test('reports a package added to a manifest', () => {
    const base = new Map([['package.json', JSON.stringify({ dependencies: { hono: '^4.6.0' } })]]);
    const head = new Map([['package.json', JSON.stringify({ dependencies: { hono: '^4.6.0', undici: '6.19.0' } })]]);
    const report = compareDependencyTrees(base, head);
    expect(report.comparedFiles).toEqual(['package.json']);
    expect(report.added).toEqual([{ name: 'undici', to: '6.19.0', file: 'package.json' }]);
  });

  test('reports a version bump with both versions', () => {
    const base = new Map([['Directory.Packages.props', '<PackageVersion Include="MessagePack" Version="2.5.140" />']]);
    const head = new Map([['Directory.Packages.props', '<PackageVersion Include="MessagePack" Version="2.5.150" />']]);
    const report = compareDependencyTrees(base, head);
    expect(report.changed).toEqual([{ name: 'MessagePack', from: '2.5.140', to: '2.5.150', file: 'Directory.Packages.props' }]);
  });
});

describe('security lens added-line rules', () => {
  const rules = [
    { id: 'SEC-UNSAFE', description: 'unsafe code', pattern: '\\bunsafe\\b', scope: 'code' as const, route: 'read' as const, points: 4 },
    { id: 'SEC-SUPPRESS', description: 'warning suppression', pattern: '#pragma\\s+warning\\s+disable', scope: 'code' as const, route: 'read' as const, points: 4 },
  ];

  test('hits unsafe code but ignores a comment mentioning unsafe', () => {
    const hits = scanSensitiveLines([
      { path: 'src/Native.cs', line: 10, text: 'public unsafe static void Copy() {}' },
      { path: 'src/Native.cs', line: 11, text: '// unsafe is discussed here, not used' },
    ], rules);
    expect(hits.map((h) => h.line)).toEqual([10]);
  });

  test('hits an added pragma that suppresses warnings', () => {
    const hits = scanSensitiveLines([{ path: 'src/Native.cs', line: 12, text: '#pragma warning disable CS0168' }], rules);
    expect(hits).toHaveLength(1);
    expect(hits[0].ruleId).toBe('SEC-SUPPRESS');
  });
});
