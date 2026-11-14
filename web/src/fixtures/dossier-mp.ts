/**
 * Fixture dossier for the real sample change: MessagePack-CSharp issue 2283.
 * The diff (files/hunks) is generated from the real git diff by scripts/gen-diff.ts.
 * Everything else is hand-written to exercise every UI state.
 */
import type { ChangeUnit, Dossier, Evidence, FileDiff } from '../../../shared/dossier';
import diffJson from './mp-diff.json';

const files = diffJson as unknown as FileDiff[];
const TC = 'src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs';
const TESTS = 'tests/MessagePack.SourceGenerator.Tests/GenericsFormatterTests.cs';
const BASE = '32258fdbee4bcd653c79f51b4376b5103c6f4d27';
const HEAD = '9df83c38409c8bfad0517aebffe48211eda4a5b4';

const hunksOf = (unitId: string) => files.flatMap((f) => f.hunks.filter((h) => h.unitId === unitId).map((h) => ({ f, h })));
const stat = (unitId: string) => {
  const hs = hunksOf(unitId);
  const lines = hs.flatMap((x) => x.h.lines);
  return {
    hunkIds: hs.map((x) => x.h.id),
    fileCount: new Set(hs.map((x) => x.f.id)).size,
    additions: lines.filter((l) => l.t === 'add').length,
    deletions: lines.filter((l) => l.t === 'del').length,
  };
};

const units: ChangeUnit[] = [
  {
    id: 'U1',
    title: 'Make the two crashing diagnostic sites null-safe',
    kind: 'core-logic',
    summary:
      'Two places built a diagnostic location with DeclaringSyntaxReferences[0]. A type that lives in a referenced assembly has no syntax, so the index threw. Both now use FirstOrDefault() and a new helper that returns null instead.',
    ...stat('U1'),
    tier: 'T1',
    riskFactors: [
      { key: 'novel-logic', label: 'Changes behaviour on a crash path', detail: 'Lines 985 and 1077 of TypeCollector.cs sit inside GetObjectInfo, the function named in the stack trace of the requirement.', points: 2 },
      { key: 'blast-radius', label: 'GetObjectInfo is reached from 6 call sites', detail: 'Reference scan for TypeCollector.GetObjectInfo at head: 6 callers, all inside TypeCollector.', points: 1, evidenceIds: ['E8'] },
      { key: 'untested', label: 'Red→green on 3 tests, ablation killed', detail: 'The 3 PR tests fail on base and pass on head. Reverting only this unit makes all 3 fail again.', points: -3, evidenceIds: ['E2', 'E5'] },
      { key: 'size', label: '11 changed lines', detail: '+9 −2 in one file.', points: -1 },
    ],
    criteriaIds: ['AC1', 'AC2'],
    traced: true,
    ask: 'skim',
    storyOrder: 1,
    readingNote:
      'Check that a null location is acceptable to Diagnostic.Create at both sites (it becomes Location.None). The helper swaps a hard cast for `as`, which is what makes record-struct positional members safe.',
  },
  {
    id: 'U2',
    title: 'Guard every analyzer diagnostic: report only if it is located in this compilation',
    kind: 'core-logic',
    summary:
      'The collector no longer calls the analyzer callback directly. Every diagnostic now passes through ReportIfLocatedInCompilation, which silently drops any diagnostic whose location is not in a syntax tree of the project being compiled.',
    ...stat('U2'),
    tier: 'T2',
    riskFactors: [
      { key: 'behaviour-change', label: 'Changes what users see, outside the requirement', detail: 'Diagnostics for types from referenced assemblies used to be reported (without a location). They are now dropped. The requirement asks for no crash, not for fewer diagnostics.', points: 3, evidenceIds: ['E7'] },
      { key: 'blast-radius', label: 'All 27 report sites now pass through it', detail: 'Every live this.reportDiagnostic?.Invoke(...) call in TypeCollector.cs is routed through the wrapper assigned at line 239.', points: 3, evidenceIds: ['E8'] },
      { key: 'error-handling', label: 'Silent drop, no log or counter', detail: 'The guard has no else branch: a dropped diagnostic leaves no trace in build output.', points: 2 },
      { key: 'area-trust', label: 'Area "Source generator" is Supervised', detail: 'Trust level 1 of 3 in the ledger: 4 clean sign-offs since the last escape, promotion at 8.', points: 1 },
      { key: 'untested', label: 'Ablation killed by exactly 1 test', detail: 'Reverting only this unit fails ClosedGenericStruct_FromMetadataReference_UnkeyedMember; the other 2 tests still pass.', points: -2, evidenceIds: ['E6'] },
    ],
    criteriaIds: ['AC2'],
    traced: true,
    ask: 'read',
    storyOrder: 2,
    readingNote:
      'This is the judgment call of the PR. Read the 7-line method and the one-line wrapper at line 239, then decide R1. Note the condition has two halves: IsInSource, and ContainsSyntaxTree — only the first is exercised by a test.',
  },
  {
    id: 'U3',
    title: 'Three regression tests that reference the generic struct as metadata only',
    kind: 'test',
    summary:
      'Adds three [Fact] tests: a generic struct, the record struct from the issue, and a struct with an unkeyed member. Each compiles the defining code to an assembly image first, so the type has no syntax in the consuming compilation.',
    ...stat('U3'),
    tier: 'T1',
    riskFactors: [
      { key: 'test-only', label: 'Test code only', detail: 'One file under tests/. Nothing here ships in the NuGet package.', points: -3 },
      { key: 'size', label: '129 added lines', detail: 'Mostly embedded C# source strings for the two compilations.', points: 1 },
      { key: 'untested', label: 'Self-test missed a weakened assertion', detail: 'One of the 5 planted bugs weakened an assertion in this file; neither the suite nor the reviewer flagged it. Test units are therefore routed to skim, not skip.', points: 2, evidenceIds: ['E11'] },
    ],
    criteriaIds: ['AC1', 'AC2', 'AC3'],
    traced: true,
    ask: 'skim',
    storyOrder: 3,
    readingNote:
      'Skim for one thing: does each test assert something that would fail if the bug came back? The second test is the exact repro from the issue.',
  },
  {
    id: 'U4',
    title: 'Test harness: compile a library to an in-memory metadata reference',
    kind: 'test',
    summary:
      'Three private helpers that emit the defining source to an assembly image, run analyzers and generator against the usage source, and assert the resolver hint name was generated.',
    ...stat('U4'),
    tier: 'T0',
    riskFactors: [
      { key: 'test-only', label: 'Test code only', detail: 'Private static helpers in the test project.', points: -3 },
      { key: 'mechanical-verified', label: 'Used only by the 3 new tests (3/3)', detail: 'Reference scan: RunWithMetadataReferenceAsync has exactly 3 callers, all added in this PR.', points: -2, evidenceIds: ['E10'] },
      { key: 'untested', label: 'Executed on every red→green run', detail: 'The helpers ran in both the base and head runs; on base they surfaced the crash, on head they passed.', points: -1, evidenceIds: ['E2'] },
    ],
    criteriaIds: ['AC3'],
    traced: true,
    ask: 'none',
    skipProof: {
      text: 'These 60 lines run only inside the 3 new tests. They produced a failing result on base and a passing result on head, so they demonstrably detect the defect. No production code references them.',
      evidenceIds: ['E2', 'E10'],
    },
    storyOrder: 4,
  },
  {
    id: 'U5',
    title: 'Docs: diagnostics for referenced types belong to the defining assembly',
    kind: 'docs',
    summary:
      'README and the MsgPack004 analyzer page now state that member diagnostics for a type from a referenced assembly are reported by the project that defines it, not by the consumer.',
    ...stat('U5'),
    tier: 'T2',
    riskFactors: [
      { key: 'untraced', label: 'Not traceable to the requirement', detail: 'Issue 2283 asks for a crash fix. Nothing in it asks for a documented change in who reports diagnostics.', points: 3 },
      { key: 'behaviour-change', label: 'Documents a policy, not a fact', detail: 'The sentence is only true if the defining assembly also runs the analyzer. For a third-party NuGet package nobody may ever see the diagnostic.', points: 2, evidenceIds: ['E13'] },
      { key: 'docs-only', label: 'Docs only, 10 lines', detail: '2 markdown files, 0 executable lines.', points: -2 },
    ],
    criteriaIds: [],
    traced: false,
    ask: 'read',
    storyOrder: 5,
    readingNote: 'Ten lines. Read them as a promise to users: is this the contract you want to publish?',
  },
];

const evidence: Evidence[] = [
  {
    id: 'E1',
    kind: 'build',
    strength: 'executed',
    title: 'Head builds',
    conclusion: 'The solution builds at the head commit with 0 errors and no new warnings.',
    polarity: 'supports',
    command: 'dotnet build MessagePack.sln -c Release --nologo -warnaserror:CS8785',
    head: {
      sha: HEAD,
      label: 'head',
      outcome: 'pass',
      passed: 0,
      failed: 0,
      skipped: 0,
      durationMs: 94200,
      excerpt: 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n\nTime Elapsed 00:01:34.20',
      log: 'E1/head-build.log',
    },
    producedBy: 'sandbox.build',
    durationMs: 94200,
  },
  {
    id: 'E2',
    kind: 'red-green',
    strength: 'executed',
    title: 'PR tests: red on base, green on head',
    conclusion: 'All 3 tests added by the PR fail on the base commit with the crash from the issue, and pass on the head commit.',
    polarity: 'supports',
    command:
      'dotnet test tests/MessagePack.SourceGenerator.Tests -c Release --no-build --filter "FullyQualifiedName~GenericsFormatterTests.ClosedGeneric"',
    base: {
      sha: BASE,
      label: 'base source + PR tests',
      outcome: 'fail',
      passed: 0,
      failed: 3,
      skipped: 0,
      durationMs: 21840,
      failing: [
        'GenericsFormatterTests.ClosedGenericStruct_FromMetadataReference',
        'GenericsFormatterTests.ClosedGenericRecordStruct_FromMetadataReference',
        'GenericsFormatterTests.ClosedGenericStruct_FromMetadataReference_UnkeyedMember',
      ],
      excerpt:
        "[xUnit.net 00:00:09.41]     GenericsFormatterTests.ClosedGenericRecordStruct_FromMetadataReference [FAIL]\n  Mismatch between number of diagnostics returned, expected \"0\" actual \"1\"\n\n  Diagnostics:\n  // warning AD0001: Analyzer 'MessagePack.SourceGenerator.Analyzers.MsgPack00xMessagePackAnalyzer' threw an\n  // exception of type 'System.IndexOutOfRangeException' with message 'Index was outside the bounds of the array.'.\n     at TypeCollector.GetObjectInfo(INamedTypeSymbol formattedType, ISymbol callerSymbol)\n     at TypeCollector.CollectGeneric(INamedTypeSymbol type, ISymbol callerSymbol)\n\nFailed!  - Failed: 3, Passed: 0, Skipped: 0, Total: 3, Duration: 12 s",
      log: 'E2/base.log',
    },
    head: {
      sha: HEAD,
      label: 'head',
      outcome: 'pass',
      passed: 3,
      failed: 0,
      skipped: 0,
      durationMs: 19310,
      excerpt: 'Passed!  - Failed: 0, Passed: 3, Skipped: 0, Total: 3, Duration: 10 s - MessagePack.SourceGenerator.Tests.dll (net8.0)',
      log: 'E2/head.log',
    },
    producedBy: 'sandbox.red-green',
    durationMs: 41150,
  },
  {
    id: 'E3',
    kind: 'repro',
    strength: 'executed',
    title: 'Issue repro (mp-repro.zip): resolver is generated',
    conclusion: 'The two-project repro attached to the issue builds with CS8785 and no resolver on base, and builds clean with GeneratedMessagePackResolver present on head.',
    polarity: 'supports',
    command: 'bash probes/repro-2283.sh   # builds lib + app against a locally packed MessagePack, then inspects app.dll',
    base: {
      sha: BASE,
      label: 'issue repro against base package',
      outcome: 'fail',
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 38120,
      failing: ['app.dll contains GeneratedMessagePackResolver'],
      excerpt:
        "CSC : warning CS8785: Generator 'MessagePackGenerator' failed to generate source. It will not contribute to the output and\ncompilation errors may occur as a result. Exception was of type 'IndexOutOfRangeException' with message\n'Index was outside the bounds of the array.'. [/work/repro/app/app.csproj]\n\n$ monodis --typedef app.dll | grep -c GeneratedMessagePackResolver\n0\nFAIL: resolver missing",
      log: 'E3/base.log',
    },
    head: {
      sha: HEAD,
      label: 'issue repro against head package',
      outcome: 'pass',
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 36900,
      excerpt: 'Build succeeded.\n    0 Warning(s)\n    0 Error(s)\n\n$ monodis --typedef app.dll | grep -c GeneratedMessagePackResolver\n1\nPASS: resolver present',
      log: 'E3/head.log',
    },
    probeSource: {
      path: 'probes/repro-2283.sh',
      language: 'bash',
      code: `#!/usr/bin/env bash
# Reproduces MessagePack-CSharp issue 2283 exactly as reported.
set -euo pipefail
SHA="$1"                                   # base or head
git -C /work/mp checkout -q "$SHA"
dotnet pack /work/mp/src/MessagePack -c Release -o /work/feed -p:Version=0.0.0-probe --nologo -v q

unzip -qo /work/issue/mp-repro.zip -d /work/repro
cd /work/repro
dotnet build app/app.csproj --source /work/feed -p:MessagePackVersion=0.0.0-probe --nologo

count=$(monodis --typedef app/bin/Debug/net8.0/app.dll | grep -c GeneratedMessagePackResolver || true)
echo "$count"
[ "$count" -ge 1 ] && echo "PASS: resolver present" || { echo "FAIL: resolver missing"; exit 1; }`,
    },
    producedBy: 'agent.repro',
    durationMs: 75020,
  },
  {
    id: 'E4',
    kind: 'regression',
    strength: 'executed',
    title: 'Existing generator + analyzer suite: no regressions',
    conclusion: 'Every test that passed on base still passes on head: 418 on base, 421 on head (the 3 new ones), 2 skipped on both.',
    polarity: 'supports',
    command: 'dotnet test tests/MessagePack.SourceGenerator.Tests -c Release --no-build',
    base: {
      sha: BASE,
      label: 'base',
      outcome: 'pass',
      passed: 418,
      failed: 0,
      skipped: 2,
      durationMs: 183400,
      excerpt: 'Passed!  - Failed: 0, Passed: 418, Skipped: 2, Total: 420, Duration: 2 m 58 s - MessagePack.SourceGenerator.Tests.dll (net8.0)',
      log: 'E4/base.log',
    },
    head: {
      sha: HEAD,
      label: 'head',
      outcome: 'pass',
      passed: 421,
      failed: 0,
      skipped: 2,
      durationMs: 186900,
      excerpt: 'Passed!  - Failed: 0, Passed: 421, Skipped: 2, Total: 423, Duration: 3 m 01 s - MessagePack.SourceGenerator.Tests.dll (net8.0)',
      log: 'E4/head.log',
    },
    producedBy: 'sandbox.regression',
    durationMs: 370300,
  },
  {
    id: 'E5',
    kind: 'ablation',
    strength: 'executed',
    title: 'Ablation: revert U1 (null-safe sites)',
    conclusion: 'With only the null-safety change reverted, all 3 PR tests fail again. The tests depend on this unit.',
    polarity: 'supports',
    command: 'git apply -R ablation/U1.patch && dotnet test tests/MessagePack.SourceGenerator.Tests --filter "FullyQualifiedName~ClosedGeneric"',
    ablation: {
      unitId: 'U1',
      killed: true,
      result: {
        sha: HEAD,
        label: 'head with U1 reverted',
        outcome: 'fail',
        passed: 0,
        failed: 3,
        skipped: 0,
        durationMs: 20410,
        failing: [
          'GenericsFormatterTests.ClosedGenericStruct_FromMetadataReference',
          'GenericsFormatterTests.ClosedGenericRecordStruct_FromMetadataReference',
          'GenericsFormatterTests.ClosedGenericStruct_FromMetadataReference_UnkeyedMember',
        ],
        excerpt: "warning AD0001: Analyzer 'MsgPack00xMessagePackAnalyzer' threw an exception of type 'System.IndexOutOfRangeException'\nFailed!  - Failed: 3, Passed: 0, Skipped: 0, Total: 3",
        log: 'E5/ablation-U1.log',
      },
    },
    producedBy: 'sandbox.ablation',
    durationMs: 20410,
  },
  {
    id: 'E6',
    kind: 'ablation',
    strength: 'executed',
    title: 'Ablation: revert U2 (location guard)',
    conclusion: 'With only the guard reverted, 1 of 3 PR tests fails. The guard is covered, but by a single test.',
    polarity: 'supports',
    command: 'git apply -R ablation/U2.patch && dotnet test tests/MessagePack.SourceGenerator.Tests --filter "FullyQualifiedName~ClosedGeneric"',
    ablation: {
      unitId: 'U2',
      killed: true,
      result: {
        sha: HEAD,
        label: 'head with U2 reverted',
        outcome: 'fail',
        passed: 2,
        failed: 1,
        skipped: 0,
        durationMs: 19870,
        failing: ['GenericsFormatterTests.ClosedGenericStruct_FromMetadataReference_UnkeyedMember'],
        excerpt:
          'Mismatch between number of diagnostics returned, expected "0" actual "1"\n\n  Diagnostics:\n  // warning MsgPack004: Properties and fields of base types of MessagePackObject-attributed types require either\n  // KeyAttribute or IgnoreMemberAttribute: global::TempProject.MyGenericStruct<int>.Unkeyed   (no location)\n\nFailed!  - Failed: 1, Passed: 2, Skipped: 0, Total: 3',
        log: 'E6/ablation-U2.log',
      },
    },
    producedBy: 'sandbox.ablation',
    durationMs: 19870,
  },
  {
    id: 'E7',
    kind: 'repro',
    strength: 'executed',
    title: 'Probe: a diagnostic that base reports is silent on head',
    conclusion: 'For a referenced non-generic type with no usable constructor, base reports MsgPack007 in the consuming build; head reports nothing and the build is clean.',
    polarity: 'undermines',
    command: 'dotnet test probes/Probe.DroppedDiagnostics --filter "FullyQualifiedName~NoCtor_FromMetadataReference"',
    base: {
      sha: BASE,
      label: 'base + probe',
      outcome: 'pass',
      passed: 1,
      failed: 0,
      skipped: 0,
      durationMs: 8420,
      excerpt: 'diagnostics reported to the consuming compilation: 1\n  MsgPack007 (Error, no location): Deserialization constructor not found for global::Lib.Sealed\nPassed!  - Failed: 0, Passed: 1',
      log: 'E7/base.log',
    },
    head: {
      sha: HEAD,
      label: 'head + probe',
      outcome: 'fail',
      passed: 0,
      failed: 1,
      skipped: 0,
      durationMs: 8110,
      failing: ['DroppedDiagnosticsProbe.NoCtor_FromMetadataReference'],
      excerpt: 'diagnostics reported to the consuming compilation: 0\nAssert.Single() Failure: The collection was empty\nFailed!  - Failed: 1, Passed: 0',
      log: 'E7/head.log',
    },
    probeSource: {
      path: 'probes/Probe.DroppedDiagnostics/NoCtorProbe.cs',
      language: 'csharp',
      code: `// Written by the review agent. Not part of the PR.
public class DroppedDiagnosticsProbe
{
    [Fact]
    public async Task NoCtor_FromMetadataReference()
    {
        // Lib: a [MessagePackObject] class whose only constructor is private.
        MetadataReference lib = await Compile("Lib", """
            using MessagePack;
            namespace Lib;
            [MessagePackObject]
            public class Sealed { private Sealed() { } [Key(0)] public int A { get; set; } }
            """);

        // App: uses Lib.Sealed as a member type.
        var diagnostics = await RunAnalyzer("""
            using MessagePack; using Lib;
            [MessagePackObject]
            public class Holder { [Key(0)] public Sealed Value { get; set; } }
            """, lib);

        Console.WriteLine($"diagnostics reported to the consuming compilation: {diagnostics.Length}");
        // On base the consumer is told the member type cannot be deserialized.
        Assert.Single(diagnostics, d => d.Id == "MsgPack007");
    }
}`,
    },
    refs: [
      { path: TC, startLine: 1446, endLine: 1449, quote: 'if (diagnostic.Location.IsInSource && this.compilation.ContainsSyntaxTree(diagnostic.Location.SourceTree))' },
    ],
    producedBy: 'agent.finding-repro',
    durationMs: 16530,
  },
  {
    id: 'E8',
    kind: 'reference-scan',
    strength: 'verified-static',
    title: 'Blast radius: 27 report sites pass through the guard',
    conclusion: 'All 27 live diagnostic report sites in TypeCollector.cs call this.reportDiagnostic, which line 239 now wraps in the guard. No site bypasses it.',
    polarity: 'neutral',
    command: "rg -n 'reportDiagnostic\\?\\.Invoke' src/MessagePack.SourceGenerator/CodeAnalysis/TypeCollector.cs | rg -v '////'",
    references: {
      symbol: 'TypeCollector.reportDiagnostic',
      count: 27,
      sample: [
        { path: TC, startLine: 397, endLine: 397, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.UnionAttributeRequired,' },
        { path: TC, startLine: 695, endLine: 695, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.MessageFormatterMustBeMessagePackFormatter, location' },
        { path: TC, startLine: 985, endLine: 985, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.BothStringAndIntKeyAreNull, GetPropertyIdentifierLocation(item),' },
        { path: TC, startLine: 1080, endLine: 1080, quote: 'this.reportDiagnostic?.Invoke(diagnostic);' },
        { path: TC, startLine: 1211, endLine: 1211, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.NoDeserializingConstructor, GetIdentifierLocation(' },
        { path: TC, startLine: 1345, endLine: 1345, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.TypeMustBeMessagePackObject, location, typeInfo,' },
      ],
    },
    producedBy: 'static.reference-scan',
    durationMs: 640,
  },
  {
    id: 'E9',
    kind: 'reference-scan',
    strength: 'verified-static',
    title: 'Coverage gap: line 985 is not reached by any new test',
    conclusion: 'None of the 3 new tests declares a property without both key kinds, so the rewritten BothStringAndIntKeyAreNull site at line 985 is never executed against a metadata symbol.',
    polarity: 'undermines',
    command: 'dotnet test ... --collect "XPlat Code Coverage" && reportgenerator -reports:coverage.cobertura.xml -classfilters:+TypeCollector',
    references: {
      symbol: 'TypeCollector.cs:985 (BothStringAndIntKeyAreNull)',
      count: 0,
      sample: [
        { path: TC, startLine: 985, endLine: 985, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.BothStringAndIntKeyAreNull, GetPropertyIdentifierLocation(item),' },
      ],
    },
    producedBy: 'static.coverage',
    durationMs: 31200,
  },
  {
    id: 'E10',
    kind: 'mechanical',
    strength: 'verified-static',
    title: 'Harness helpers are test-only and used by exactly the 3 new tests',
    conclusion: 'RunWithMetadataReferenceAsync, CompileToMetadataReferenceAsync and CreateCompilation are private static, live in the test project, and every call site was added by this PR.',
    polarity: 'supports',
    command: "rg -n 'RunWithMetadataReferenceAsync|CompileToMetadataReferenceAsync|CreateCompilation\\(' --glob '*.cs'",
    mechanical: {
      rule: 'Every reference to a helper added in U4 is inside tests/ and inside a hunk of this PR',
      matched: 7,
      total: 7,
      exceptions: [],
    },
    refs: [
      { path: TESTS, startLine: 633, endLine: 633, quote: 'private static async Task RunWithMetadataReferenceAsync(' },
      { path: TESTS, startLine: 661, endLine: 661, quote: 'private static async Task<MetadataReference> CompileToMetadataReferenceAsync(' },
    ],
    producedBy: 'static.mechanical',
    durationMs: 410,
  },
  {
    id: 'E11',
    kind: 'canary',
    strength: 'executed',
    title: 'Reviewer self-test: 4 of 5 planted bugs caught',
    conclusion: 'Five bugs were planted in a copy of this change. The reviewer flagged 4. It missed a weakened assertion in test code.',
    polarity: 'neutral',
    command: 'countersign selftest --pr 14 --plant 5 --seed 2283',
    producedBy: 'selftest.canary',
    durationMs: 212000,
  },
  {
    id: 'E12',
    kind: 'quote-check',
    strength: 'verified-static',
    title: 'Every quoted line exists verbatim at the head commit',
    conclusion: 'All 11 code quotes used in findings, decisions and evidence were matched byte-for-byte against the head commit. 1 quote from a draft finding did not match; that finding was killed.',
    polarity: 'supports',
    command: 'countersign verify-quotes --sha 9df83c3',
    mechanical: {
      rule: 'Quoted text equals the file content at path:startLine–endLine on the stated side',
      matched: 11,
      total: 12,
      exceptions: ['Draft finding D2 quoted "diagnostic.Location.SourceTree.FilePath" at TypeCollector.cs:1446 — not present. Finding discarded.'],
    },
    producedBy: 'verifier.quotes',
    durationMs: 180,
  },
  {
    id: 'E13',
    kind: 'analysis',
    strength: 'reasoned',
    title: 'Reading of the new docs sentence',
    conclusion: 'The docs say the defining assembly reports the problem. That holds only when the defining project also references the MessagePack analyzer; nothing was executed to check packages that do not.',
    polarity: 'undermines',
    refs: [
      { path: 'README.md', startLine: 1642, endLine: 1642, quote: 'Diagnostics about the members of such a type are reported by the assembly that defines it rather than by the consuming project, so any problem must be fixed there.' },
    ],
    producedBy: 'agent.reviewer',
  },
];

export const mpDossier: Dossier = {
  schema: 1,
  id: 'te-industry-tech-office/junction26-messagepack-csharp#14',
  slug: 'te-industry-tech-office__junction26-messagepack-csharp__14',
  status: 'ready',
  generatedAt: '2026-11-13T17:42:10Z',
  pr: {
    owner: 'te-industry-tech-office',
    repo: 'junction26-messagepack-csharp',
    number: 14,
    url: 'https://github.com/te-industry-tech-office/junction26-messagepack-csharp/pull/14',
    title: 'Fix generator and analyzer crash on closed generic structs from referenced assemblies',
    body: 'implementation for #2283\n\nFixes the IndexOutOfRangeException in TypeCollector when a member type is a closed generic value type from a referenced assembly. Adds tests and documentation.',
    author: 'ju26-coding-agent',
    authorKind: 'agent',
    baseRef: 'develop',
    headRef: 'ju26-issue-2283',
    baseSha: BASE,
    headSha: HEAD,
    additions: 225,
    deletions: 3,
    changedFiles: 4,
    createdAt: '2026-11-13T16:58:00Z',
  },
  requirement: {
    id: 'REQ-2283',
    title: 'Generator and analyzer crash with IndexOutOfRangeException on a closed generic struct from a referenced assembly',
    sourceUrl: 'https://github.com/MessagePack-CSharp/MessagePack-CSharp/issues/2283',
    body: `#### Bug description

Both \`MessagePackGenerator\` (CS8785) and \`MsgPack00xMessagePackAnalyzer\` (AD0001) throw \`IndexOutOfRangeException\` when a \`[MessagePackObject]\` type has a member whose type is a **closed generic value type defined in a referenced assembly**.

Because the generator then "will not contribute to the output", the compiling assembly silently ends up with **no generated resolver at all**. It is only a warning, so a normal build looks fine, but trimmed and NativeAOT apps fail at runtime. In our case three assemblies of a large app had been shipping without a resolver across two releases before we noticed.

#### Repro steps

Two projects. \`lib\`:

\`\`\`csharp
[MessagePackObject]
public partial record struct Item<T>([property: Key(0)] string Key);
\`\`\`

\`app\`, with a \`ProjectReference\` to \`lib\`:

\`\`\`csharp
[MessagePackObject]
public sealed partial record Cmd([property: Key(0)] string Scope)
{
    [Key(1)] public Item<int> Member { get; init; }
}
\`\`\`

#### Expected behavior

A clean build, with a generated resolver in \`app\`.

#### Additional context

It needs all three of: **generic**, **value type**, **from a referenced assembly**. \`struct Item\`, \`record struct Item\`, \`class Item<T>\` and \`record class Item<T>\` are ok.

Several diagnostic paths inside \`GetObjectInfo\` index \`DeclaringSyntaxReferences[0]\` directly (lines 735, 1009, 1101) instead of using \`FirstOrDefault()\` the way the neighbouring helpers already do, and that collection is empty for a metadata symbol.

- Version used: MessagePack 3.1.8
- Runtime: .NET 10 (SDK 10.0.204), Windows 11`,
    criteria: [
      {
        id: 'AC1',
        text: 'The source generator does not fail (no CS8785) when a member type is a closed generic value type from a referenced assembly.',
        sourceQuote: 'Both `MessagePackGenerator` (CS8785) and `MsgPack00xMessagePackAnalyzer` (AD0001) throw `IndexOutOfRangeException`',
        kind: 'functional',
        status: 'proven',
        evidenceIds: ['E2', 'E3', 'E5'],
      },
      {
        id: 'AC2',
        text: 'The analyzer does not throw (no AD0001) for the same input.',
        sourceQuote: 'Both `MessagePackGenerator` (CS8785) and `MsgPack00xMessagePackAnalyzer` (AD0001) throw `IndexOutOfRangeException`',
        kind: 'functional',
        status: 'proven',
        evidenceIds: ['E2', 'E6'],
      },
      {
        id: 'AC3',
        text: 'The consuming assembly contains a generated resolver.',
        sourceQuote: 'Expected behavior: A clean build, with a generated resolver in `app`.',
        kind: 'functional',
        status: 'proven',
        evidenceIds: ['E3', 'E2'],
      },
      {
        id: 'AC4',
        text: 'The variants that already worked (non-generic struct, generic class, generic record class) still work.',
        sourceQuote: '`struct Item`, `record struct Item`, `class Item<T>` and `record class Item<T>` are ok.',
        kind: 'implicit',
        status: 'supported',
        evidenceIds: ['E4'],
        note: 'Generic classes from source are covered by the existing suite. The four metadata variants in the issue table were not each run.',
      },
      {
        id: 'AC5',
        text: 'Nothing that passed before the change fails after it.',
        kind: 'implicit',
        status: 'proven',
        evidenceIds: ['E4', 'E1'],
      },
      {
        id: 'AC6',
        text: 'Diagnostics that users saw before the change are still reported.',
        kind: 'implicit',
        status: 'violated',
        evidenceIds: ['E7', 'E8'],
        note: 'Violated by design of the fix: see finding FN1 and decision R1. Whether that is acceptable is yours to decide.',
      },
      {
        id: 'AC7',
        text: 'The fix holds in the reporter’s environment: .NET 10 SDK on Windows 11.',
        sourceQuote: 'Runtime: .NET 10 (SDK 10.0.204), Windows 11',
        kind: 'non-functional',
        status: 'unproven',
        evidenceIds: [],
        note: 'The sandbox runs Linux with the .NET 8 and 9 SDKs. Listed under Not checked.',
      },
    ],
  },
  story: {
    headline:
      'A type from another assembly has no source code to point at; the analyzer assumed it always did and crashed, taking the generated resolver with it.',
    before:
      'A [MessagePackObject] with a member like Item<int>, where Item<T> is a generic struct from a referenced assembly, crashed both the analyzer (AD0001) and the generator (CS8785). The build still passed with a warning, and the assembly shipped with no resolver.',
    after:
      'The collector no longer assumes a symbol has syntax. The same project builds clean and the resolver is generated. As a side effect, any diagnostic that would point outside the current project is now dropped silently.',
    steps: [
      { text: 'Stop indexing DeclaringSyntaxReferences[0] at the two sites that crash for a metadata symbol; return a null location instead.', unitIds: ['U1'] },
      { text: 'Wrap the analyzer callback so every diagnostic is reported only if its location is in the compilation being analyzed.', unitIds: ['U2'] },
      { text: 'Prove it with three tests that compile the generic struct to an assembly first, so it is referenced as metadata only.', unitIds: ['U3', 'U4'] },
      { text: 'Document that diagnostics for a referenced type are the defining assembly’s job.', unitIds: ['U5'] },
    ],
    alsoTouches: [
      'All 27 diagnostic report sites in TypeCollector now pass through the new guard, not only the two that crashed.',
      'Diagnostics about referenced types that used to appear in the consumer’s build (without a location) no longer appear at all.',
      'README and the MsgPack004 page publish this as intended behaviour.',
    ],
  },
  diagrams: [
    {
      id: 'DG1',
      title: 'Change map',
      kind: 'change-map',
      caption: 'What the PR touches and what sits downstream. Click a coloured node to jump to its change unit.',
      groups: [
        { id: 'user', label: 'User code' },
        { id: 'gen', label: 'MessagePack.SourceGenerator' },
        { id: 'proof', label: 'Proof' },
      ],
      nodes: [
        { id: 'req', label: 'REQ-2283', sublabel: 'crash on Item<int>', role: 'requirement', group: 'proof' },
        { id: 'cmd', label: 'App: Cmd', sublabel: 'member Item<int>', role: 'context', group: 'user' },
        { id: 'item', label: 'Lib: Item<T>', sublabel: 'metadata only, no syntax', role: 'external', group: 'user' },
        { id: 'analyzer', label: 'MsgPack00x Analyzer', role: 'affected', group: 'gen' },
        { id: 'generator', label: 'MessagePackGenerator', role: 'affected', group: 'gen' },
        { id: 'collect', label: 'CollectGeneric', sublabel: 'TypeCollector', role: 'context', group: 'gen' },
        { id: 'goi', label: 'GetObjectInfo', sublabel: '2 sites made null-safe', role: 'changed', group: 'gen', unitId: 'U1', tier: 'T1' },
        { id: 'helper', label: 'GetPropertyIdentifierLocation', sublabel: 'new helper', role: 'added', group: 'gen', unitId: 'U1', tier: 'T1' },
        { id: 'guard', label: 'ReportIfLocatedInCompilation', sublabel: 'new guard', role: 'added', group: 'gen', unitId: 'U2', tier: 'T2' },
        { id: 'sites', label: '27 report sites', sublabel: 'all diagnostics', role: 'affected', group: 'gen' },
        { id: 'resolver', label: 'Generated resolver', sublabel: 'now emitted', role: 'affected', group: 'user' },
        { id: 'tests', label: '3 regression tests', role: 'test', group: 'proof', unitId: 'U3', tier: 'T1' },
        { id: 'harness', label: 'Metadata harness', role: 'test', group: 'proof', unitId: 'U4', tier: 'T0' },
        { id: 'docs', label: 'README + MsgPack004', sublabel: 'untraced', role: 'changed', group: 'proof', unitId: 'U5', tier: 'T2' },
      ],
      edges: [
        { from: 'cmd', to: 'analyzer', label: 'analyzed by' },
        { from: 'cmd', to: 'generator', label: 'compiled by' },
        { from: 'analyzer', to: 'collect' },
        { from: 'generator', to: 'collect' },
        { from: 'collect', to: 'goi', label: 'closed generic' },
        { from: 'goi', to: 'item', label: 'no syntax', role: 'broken', style: 'dashed' },
        { from: 'goi', to: 'helper', role: 'new' },
        { from: 'goi', to: 'sites' },
        { from: 'sites', to: 'guard', label: 'every report', role: 'new' },
        { from: 'generator', to: 'resolver', label: 'emits', role: 'new' },
        { from: 'req', to: 'tests', label: 'criteria' },
        { from: 'tests', to: 'harness' },
        { from: 'harness', to: 'generator', label: 'runs', style: 'dashed' },
        { from: 'guard', to: 'docs', label: 'documented by', style: 'dashed' },
      ],
    },
    {
      id: 'DG2',
      title: 'Before / after',
      kind: 'before-after',
      caption: 'The same build, before and after. Red dashed: the path that failed. Green: what the change makes possible.',
      groups: [
        { id: 'before', label: 'Before' },
        { id: 'after', label: 'After' },
      ],
      nodes: [
        { id: 'b1', label: 'Cmd has Item<int>', role: 'context', group: 'before' },
        { id: 'b2', label: 'GetObjectInfo(Item<int>)', role: 'context', group: 'before' },
        { id: 'b3', label: 'DeclaringSyntaxReferences[0]', sublabel: 'empty for metadata', role: 'removed', group: 'before' },
        { id: 'b4', label: 'IndexOutOfRange', sublabel: 'AD0001 + CS8785', role: 'removed', group: 'before' },
        { id: 'b5', label: 'No resolver in app.dll', sublabel: 'fails at runtime under AOT', role: 'removed', group: 'before' },
        { id: 'a1', label: 'Cmd has Item<int>', role: 'context', group: 'after' },
        { id: 'a2', label: 'GetObjectInfo(Item<int>)', role: 'changed', group: 'after', unitId: 'U1', tier: 'T1' },
        { id: 'a3', label: 'FirstOrDefault()?', sublabel: 'location may be null', role: 'added', group: 'after', unitId: 'U1', tier: 'T1' },
        { id: 'a4', label: 'Guard: in this compilation?', sublabel: 'else drop silently', role: 'added', group: 'after', unitId: 'U2', tier: 'T2' },
        { id: 'a5', label: 'Resolver generated', role: 'affected', group: 'after' },
      ],
      edges: [
        { from: 'b1', to: 'b2' },
        { from: 'b2', to: 'b3' },
        { from: 'b3', to: 'b4', label: 'throws', role: 'broken', style: 'dashed' },
        { from: 'b4', to: 'b5', label: 'generator dies', role: 'broken', style: 'dashed' },
        { from: 'a1', to: 'a2' },
        { from: 'a2', to: 'a3', role: 'new' },
        { from: 'a3', to: 'a4', label: 'diagnostic', role: 'new' },
        { from: 'a4', to: 'a5', label: 'continues', role: 'new' },
      ],
    },
  ],
  units,
  files,
  evidence,
  findings: [
    {
      id: 'FN1',
      title: 'The guard silently drops every diagnostic about a referenced type, not only the crashing ones',
      severity: 'major',
      category: 'scope',
      body: 'The crash is fixed by U1 alone. U2 goes further: it filters all 27 report sites, so a problem in a type from another assembly now produces no output in the consuming build. Before, the consumer got a diagnostic without a location. The requirement does not ask for this.',
      scenario:
        'A team references a NuGet package whose [MessagePackObject] type has no usable constructor. On base their build reports MsgPack007. On head the build is clean, and deserialization fails at runtime.',
      refs: [
        { path: TC, startLine: 239, endLine: 239, quote: 'this.reportDiagnostic = reportAnalyzerDiagnostic is null ? null : diagnostic => ReportIfLocatedInCompilation(reportAnalyzerDiagnostic, diagnostic);' },
        { path: TC, startLine: 1446, endLine: 1449, quote: 'if (diagnostic.Location.IsInSource && this.compilation.ContainsSyntaxTree(diagnostic.Location.SourceTree))\n{\n    report(diagnostic);\n}' },
      ],
      strength: 'executed',
      evidenceIds: ['E7', 'E8'],
      suggestion:
        'Either keep the guard and report one diagnostic at the usage site in the consumer ("member type Lib.Sealed has serialization problems"), or narrow the guard to locations that are null.',
      unitId: 'U2',
    },
    {
      id: 'FN2',
      title: 'The rewritten site at line 985 is not exercised for a metadata symbol',
      severity: 'minor',
      category: 'test-gap',
      body: 'U1 changes two sites. The tests reach the MemberNeedsKey site (line 1077) but none of them declares a property whose key is neither string nor int, so the BothStringAndIntKeyAreNull site is changed without a test that runs it.',
      scenario: 'A later refactor restores the hard cast at line 985. All tests still pass, and the crash returns for that shape of input.',
      refs: [
        { path: TC, startLine: 985, endLine: 985, quote: 'this.reportDiagnostic?.Invoke(Diagnostic.Create(MsgPack00xMessagePackAnalyzer.BothStringAndIntKeyAreNull, GetPropertyIdentifierLocation(item), formattedType.ToDisplayString(SymbolDisplayFormat.FullyQualifiedFormat), item.Name));' },
      ],
      strength: 'verified-static',
      evidenceIds: ['E9'],
      suggestion: 'Add a fourth test with `[Key(null)]`-style input on the referenced struct, or extend the UnkeyedMember test.',
      unitId: 'U1',
    },
    {
      id: 'FN3',
      title: 'The docs promise that someone else will report the problem',
      severity: 'note',
      category: 'maintainability',
      body: 'The new README sentence says such diagnostics "are reported by the assembly that defines it". That is true only if the defining project also runs the MessagePack analyzer. For a prebuilt third-party package, no build anywhere will show it.',
      refs: [
        { path: 'README.md', startLine: 1642, endLine: 1642, quote: 'Diagnostics about the members of such a type are reported by the assembly that defines it rather than by the consuming project, so any problem must be fixed there.' },
      ],
      strength: 'reasoned',
      evidenceIds: ['E13'],
      suggestion: 'Soften to "should be fixed in the project that defines it", or pair with a consumer-side diagnostic.',
      unitId: 'U5',
    },
  ],
  discarded: [
    {
      id: 'D1',
      title: 'InvalidCastException for record positional properties',
      claimed: 'GetPropertyIdentifierLocation casts the declaring syntax to PropertyDeclarationSyntax; for `record struct Item<T>([property: Key(0)] string Key)` the syntax is a ParameterSyntax, so the cast throws.',
      reason: 'repro-failed',
      detail: 'The helper uses `as`, not a hard cast, and returns null. The reproduction test (record struct with a positional member, from source and from metadata) passed on head. The hard cast existed on base and is what this PR removes.',
    },
    {
      id: 'D2',
      title: 'Null dereference of SourceTree in the guard',
      claimed: 'Line 1446 reads diagnostic.Location.SourceTree.FilePath without a null check.',
      reason: 'quote-not-found',
      detail: 'The quoted expression does not exist at TypeCollector.cs:1446 or anywhere in the diff. The actual code passes SourceTree to ContainsSyntaxTree after checking IsInSource. The reviewer misread the line.',
    },
  ],
  refusals: [
    {
      id: 'R1',
      question: 'Is it acceptable that diagnostics about types from referenced assemblies are now silently dropped?',
      why: 'This is a product policy about who is told when a referenced type cannot be serialized. Both answers are defensible, and the requirement is silent on it. The AI can show what changes; it cannot decide what your users should see.',
      reasonKind: 'policy',
      options: [
        { id: 'accept', label: 'Yes, the defining assembly owns those diagnostics', consequence: 'Merge as is. Consumers of a broken third-party type get a clean build and a runtime failure. Recorded as residual risk on your attestation.' },
        { id: 'usage-site', label: 'No, report once at the usage site instead', consequence: 'Request changes: keep the guard, add one consumer-side diagnostic on the member that uses the type. This PR is not signed.' },
        { id: 'narrow', label: 'No, narrow the guard to missing locations only', consequence: 'Request changes: drop only diagnostics whose location is null. Diagnostics located in other source projects keep flowing.' },
      ],
      context:
        'On base, a diagnostic for a metadata type was reported with no location (visible in build output, not clickable). On head it is not reported. The probe E7 shows one concrete diagnostic (MsgPack007) that disappears. U1 alone is enough to fix the crash: the ablation E5 shows the tests depend on U1, and E6 shows only one test depends on the guard.',
      evidenceIds: ['E7', 'E8', 'E6'],
      refs: [{ path: TC, startLine: 1444, endLine: 1450, quote: 'private void ReportIfLocatedInCompilation(Action<Diagnostic> report, Diagnostic diagnostic)' }],
      unitId: 'U2',
      blocking: true,
    },
    {
      id: 'R2',
      question: 'Does this ship as a patch release, or does the changed analyzer behaviour need a minor version and a release note?',
      why: 'Release classification depends on your compatibility promise to package consumers, which is not written down in the repository. The AI found no versioning policy to apply.',
      reasonKind: 'compatibility',
      options: [
        { id: 'patch', label: 'Patch release (3.1.x)', consequence: 'Ships to everyone on automatic patch updates. Builds that had location-less warnings become quieter without notice.' },
        { id: 'minor', label: 'Minor release with a release note', consequence: 'Slower to reach the reporter, but the behaviour change is announced.' },
      ],
      context: 'No CHANGELOG entry is part of the PR. The package had 3 patch releases in the last 90 days; none changed analyzer output.',
      evidenceIds: ['E8'],
      unitId: 'U5',
      blocking: false,
    },
  ],
  notChecked: [
    { what: '.NET 10 SDK on Windows 11, the reporter’s environment', why: 'The sandbox image is Linux with the .NET 8 and 9 SDKs. Roslyn behaviour for metadata symbols is the same across them as far as documented, but nothing was run.' },
    { what: 'NativeAOT and trimmed publish of the repro app', why: 'The issue names AOT as where the missing resolver hurts. The sandbox checked that the resolver type exists in app.dll, not that an AOT-published app deserializes.' },
    { what: 'Other MessagePack analyzers and the Unity package', why: 'Only MessagePack.SourceGenerator.Tests was run. The 4,100-test runtime suite was skipped because no runtime code changed.' },
    { what: 'Performance of the guard on large solutions', why: 'ContainsSyntaxTree is called once per diagnostic. No benchmark was run; a draft finding about it was killed for lack of evidence.' },
    { what: 'The four metadata variants in the issue table that already worked', why: 'Covered for types declared in source by the existing suite; not each re-run as a metadata reference.' },
  ],
  selfTest: {
    planted: 5,
    caught: 4,
    reading:
      'The reviewer caught every planted logic bug, including one the test suite missed. It missed a weakened assertion in test code. Read this as: trust its findings on logic, and skim the tests yourself. That is why U3 is routed to skim instead of skip.',
    canaries: [
      { id: 'C1', description: 'Inverted the guard condition (`!diagnostic.Location.IsInSource`)', path: TC, line: 1446, caughtByTests: true, caughtByReviewer: true },
      { id: 'C2', description: 'Replaced `as PropertyDeclarationSyntax` with a hard cast in the new helper', path: TC, line: 1434, caughtByTests: true, caughtByReviewer: true },
      { id: 'C3', description: 'Replaced `FirstOrDefault()?` with `First()` at the MemberNeedsKey site', path: TC, line: 1077, caughtByTests: true, caughtByReviewer: true },
      { id: 'C4', description: 'Removed the ContainsSyntaxTree half of the guard, so diagnostics from other compilations leak through', path: TC, line: 1446, caughtByTests: false, caughtByReviewer: true, note: 'No test covers a diagnostic located in a different source compilation.' },
      { id: 'C5', description: 'Weakened `Assert.Contains(expectedResolverHintName, hintNames)` to `Assert.NotNull(hintNames)`', path: TESTS, line: 658, caughtByTests: false, caughtByReviewer: false, note: 'Missed. The reviewer does not yet compare assertion strength against the criterion it claims to prove.' },
    ],
  },
  routing: {
    tier: 'T2',
    score: 7,
    areas: [
      { area: 'Source generator', trustLevel: 1, trustLabel: 'Supervised' },
      { area: 'Docs', trustLevel: 3, trustLabel: 'Proven' },
    ],
    readLines: units.filter((u) => u.ask === 'read').reduce((s, u) => s + u.additions + u.deletions, 0),
    skimLines: units.filter((u) => u.ask === 'skim').reduce((s, u) => s + u.additions + u.deletions, 0),
    skipLines: units.filter((u) => u.ask === 'none').reduce((s, u) => s + u.additions + u.deletions, 0),
    totalLines: units.reduce((s, u) => s + u.additions + u.deletions, 0),
    estMinutes: 3,
    spotCheck: { selected: false, reason: 'Not sampled. 1 in 5 PRs in a Supervised area gets a full human read; this one drew 0.62 against a threshold of 0.20.' },
    policyVersion: '2026-11-12.3',
    rulesFired: [
      'behaviour-change outside the requirement ⇒ unit is at least T2',
      'untraced unit ⇒ read, regardless of size',
      'test-only + executed red→green + no production reference ⇒ T0',
      'self-test missed a test-code canary ⇒ test units skim, not skip',
      'area trust Supervised ⇒ +1 on core-logic units',
    ],
  },
  recommendation: {
    verdict: 'accept-after-decisions',
    summary:
      'The crash is fixed and proven by execution. The fix also changes which diagnostics users see, which only you can accept.',
    distrustIf: [
      'You need diagnostics about third-party types in consumer builds.',
      'The fix must be verified on .NET 10 / Windows before release.',
      'You consider one test enough coverage for a guard on all 27 report sites.',
    ],
  },
  stages: [
    { name: 'fetch', title: 'Fetch PR and requirement', status: 'done', durationMs: 3100, detail: 'PR #14, issue 2283, 4 files' },
    { name: 'criteria', title: 'Derive acceptance criteria from the requirement', status: 'done', durationMs: 21400, model: 'claude-opus-5-5', costUsd: 0.21, detail: '7 criteria, PR description not shown to the model' },
    { name: 'units', title: 'Group the diff into change units', status: 'done', durationMs: 18900, model: 'claude-sonnet-5-5', costUsd: 0.06, detail: '8 hunks → 5 units' },
    { name: 'sandbox', title: 'Build, red→green, regression', status: 'done', durationMs: 505600, detail: '3 runs on base, 3 on head' },
    { name: 'ablation', title: 'Ablation: revert each unit', status: 'done', durationMs: 40300, detail: '2 units, 2 killed' },
    { name: 'review', title: 'Review and write probes', status: 'done', durationMs: 164000, model: 'claude-fable-5-2', costUsd: 1.92, detail: '5 draft findings, 2 probes' },
    { name: 'verify', title: 'Verify findings', status: 'done', durationMs: 58200, model: 'claude-opus-5-5', costUsd: 0.44, detail: '3 kept, 2 killed' },
    { name: 'selftest', title: 'Reviewer self-test (canaries)', status: 'done', durationMs: 212000, model: 'claude-fable-5-2', costUsd: 1.37, detail: '5 planted, 4 caught' },
    { name: 'route', title: 'Risk tiers and reading plan', status: 'done', durationMs: 900, detail: 'policy 2026-11-12.3' },
    { name: 'compose', title: 'Compose dossier', status: 'done', durationMs: 12600, model: 'claude-sonnet-5-5', costUsd: 0.05 },
  ],
};
