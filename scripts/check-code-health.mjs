#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionPaths = ['src', 'scripts'];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && !options.allowFailure) {
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    throw new Error(`${command} exited with status ${result.status}`);
  }
  return result;
}

function commandWithUvx(command, uvxArgs) {
  const probe = spawnSync(command, ['--version'], { encoding: 'utf8' });
  return probe.status === 0 ? { command, prefix: [] } : { command: 'uvx', prefix: uvxArgs };
}

function failRegressions(label, observed, baseline) {
  const regressions = Object.entries(baseline).filter(([key, maximum]) => observed[key] > maximum);
  if (regressions.length > 0) {
    throw new Error(
      regressions
        .map(([key, maximum]) => `${label} ${key} regressed: ${observed[key]} > ${maximum}`)
        .join('\n')
    );
  }
  if (Object.entries(baseline).some(([key, maximum]) => observed[key] < maximum)) {
    console.log(`${label} improved; lower the checked-in baseline in the next intentional update.`);
  }
}

function checkComplexity() {
  const lizard = commandWithUvx('lizard', ['--from', 'lizard==1.23.0', 'lizard']);
  const result = run(lizard.command, [
    ...lizard.prefix,
    ...productionPaths,
    '-x',
    '**/*.test.*',
    '-x',
    '**/*.spec.*',
    '--csv',
  ]);
  const rows = result.stdout
    .trim()
    .split('\n')
    .map((line) => line.match(/^(\d+),(\d+),(\d+),(\d+),(\d+),/u))
    .filter(Boolean)
    .map((match) => match.slice(1).map(Number));
  const observed = {
    functions: rows.length,
    nloc: rows.reduce((sum, row) => sum + row[0], 0),
    violations: rows.filter((row) => row[1] > 15 || row[4] > 100 || row[3] > 7).length,
    maxCcn: Math.max(...rows.map((row) => row[1])),
    maxLength: Math.max(...rows.map((row) => row[4])),
    maxParams: Math.max(...rows.map((row) => row[3])),
  };
  // Ratcheted ADR-approved debt: https://github.com/sass-maker/free-ai/issues/53
  const baseline = { violations: 28, maxCcn: 34, maxLength: 448, maxParams: 4 };
  console.log(
    `Complexity: ${observed.functions} functions, ${observed.nloc} NLOC, ` +
      `${observed.violations} violations; max CCN ${observed.maxCcn}, ` +
      `max length ${observed.maxLength}, max params ${observed.maxParams}.`
  );
  failRegressions('Complexity', observed, baseline);
}

function checkDuplication() {
  const outputDirectory = join(tmpdir(), `free-ai-jscpd-${process.pid}`);
  run('pnpm', [
    'exec',
    'jscpd',
    ...productionPaths,
    '--format',
    'javascript,typescript',
    '--min-lines',
    '8',
    '--min-tokens',
    '60',
    '--mode',
    'strict',
    '--ignore',
    '**/*.test.*,**/*.spec.*,**/node_modules/**,**/coverage/**,**/dist/**',
    '--reporters',
    'json',
    '--output',
    outputDirectory,
    '--silent',
    '--no-tips',
  ]);
  const observed = JSON.parse(readFileSync(join(outputDirectory, 'jscpd-report.json'), 'utf8'))
    .statistics.total;
  // Ratcheted protocol/monolith debt: https://github.com/sass-maker/free-ai/issues/53
  const baseline = {
    clones: 28,
    duplicatedLines: 454,
    percentage: 3.3470952521380126,
  };
  console.log(
    `Duplication: ${observed.duplicatedLines}/${observed.lines} lines ` +
      `(${observed.percentage.toFixed(4)}%), ${observed.clones} groups across ` +
      `${observed.sources} files.`
  );
  failRegressions('Duplication', observed, baseline);
}

function checkDependencies() {
  const report = JSON.parse(run('pnpm', ['audit', '--json'], { allowFailure: true }).stdout);
  // Accepted development-tool debt: https://github.com/sass-maker/free-ai/issues/53
  const accepted = new Set(['GHSA-5p2g-fcmc-qvqq', 'GHSA-w3rx-r6r6-pgpr']);
  const severe = Object.values(report.advisories ?? {}).filter((advisory) =>
    ['critical', 'high'].includes(advisory.severity)
  );
  const unexpected = severe.filter((advisory) => !accepted.has(advisory.github_advisory_id));
  const critical = severe.filter((advisory) => advisory.severity === 'critical').length;
  const high = severe.filter((advisory) => advisory.severity === 'high').length;
  console.log(
    `Dependencies: ${critical} critical, ${high} high, ${unexpected.length} unexpected; ` +
      `${severe.length - unexpected.length} accepted development-tool advisories.`
  );
  if (unexpected.length > 0) {
    throw new Error(
      `Unexpected critical/high advisories: ${unexpected
        .map((advisory) => advisory.github_advisory_id)
        .join(', ')}`
    );
  }
}

function checkSuppressions() {
  const result = run(
    'git',
    [
      'grep',
      '-n',
      '-E',
      '(^|[[:space:]])(//|/\\*)[[:space:]]*(biome-ignore|eslint-disable|@ts-ignore|@ts-expect-error)',
      '--',
      ...productionPaths,
    ],
    { allowFailure: true }
  );
  const observed = result.stdout.trim() ? result.stdout.trim().split('\n').length : 0;
  // Ratcheted justified directives: https://github.com/sass-maker/free-ai/issues/53
  const baseline = 2;
  console.log(`Suppressions: ${observed} justified inline directives.`);
  if (observed > baseline) {
    throw new Error(`Suppressions regressed: ${observed} > ${baseline}`);
  }
  if (observed < baseline) {
    console.log(
      'Suppressions improved; lower the checked-in baseline in the next intentional update.'
    );
  }
}

const checks = {
  complexity: checkComplexity,
  dependencies: checkDependencies,
  duplication: checkDuplication,
  suppressions: checkSuppressions,
};
const selected = process.argv[2];

if (!Object.hasOwn(checks, selected)) {
  console.error(`Usage: check-code-health.mjs <${Object.keys(checks).join('|')}>`);
  process.exit(2);
}

try {
  checks[selected]();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
